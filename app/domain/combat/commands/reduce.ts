import type { CampaignCharacter } from '../../types'
import { TerrainCellSchema, type Action, type Board, type CombatState, type FloorItem, type Grapple, type GrappleFacts, type Trample } from '../types'
import { payCost } from '../../character/commands/cost'
import { cure, inflict } from '../../character/commands/addAffliction'
import { deliver, deliverAll } from '../../character/commands/deliver'
import { chargeItem, consumeItem, dischargeItem, dropItem, holdItem } from '../../item/commands/hands'
import { getHeldItem } from '../../item/rules/hands'
import { findAmmoStack } from '../../item/rules/ammo'
import { removeItemFromContainer } from '../../item/commands/items'
import { findWeaponRow } from '../rules/weaponRow'
import { getAttackKind } from '../../weaponProperties'
import { onFloor } from '../rules/floor'
import { getMoveDestination } from '../rules/waypoint'
import { isAttackAction } from '../rules/actionCatalog'
import { getChargedWeapon, getHOPPrice } from '../rules/damage'
import { HOP_PURCHASES } from '../../lists'
import { dropHolders, getGrappleFacts, replacePair } from '../rules/grapple'
import { coordKey } from '../geometry'
import { SPELLS, isSpellKey } from '../../spells'
import { STUN_AP } from '../../tables'
import { GRAZE_SAVE_COST, getCastSpentAP, isSpellTestBeaten } from '../rules/cast'
import { getEffortlessCost } from '../../character/rules/spells'
import { payCarefulMove, restCharacter, restWhileCasting } from '../../character/commands/rest'
import { getInterruptionOf } from '../rules/interruption'
import { getLinkSpell } from '../../character/rules/concentration'
import { linkTarget, loseConcentration, unlinkTarget } from '../../character/commands/spells'
import { getReactionsTo } from '../rules/log'
import { actionSurge } from '../../character/commands/actionSurge'

// The moments an action touches a character: `roll`, when the die is thrown
// and the price leaves the actor in the same step; `save`, when a graze is
// bought up after the roll and its price leaves the actor; and `resolve`,
// when what the action did lands on whoever it was done to.
export type Phase = 'roll' | 'save' | 'resolve'

// The one place an action changes a character. It reads the action and the
// character's part in it — actor, target, nobody — and applies only that
// part, so a fight can run every character through it and the ones an action
// does not concern come out untouched. Everything it needs is on the action:
// what had to be looked up across two characters was written there by the
// command that made the transition; what the action delivers is handed to
// the character's own effect processor, which needs nothing but the record.
// One the action interrupted stops concentrating, and every spell they held
// ends with it (abilities.tex "Battle Mage": "When interrupted, instead of
// losing the spell") — a won maneuver here; a blow that interrupts or stuns
// ends it where it lands (character/commands/deliver.ts), as a crash does
// (`trampledBy`).
export function reduceCharacter(action: Action, phase: Phase): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const reduced = reducePart(action, phase)(c)
    return phase === 'resolve' && getInterruptionOf(action, c.id) !== 'none' ? loseConcentration(reduced) : reduced
  }
}

function reducePart(action: Action, phase: Phase): (c: CampaignCharacter) => CampaignCharacter {
  return (before: CampaignCharacter) => {
    const c = phase === 'resolve' ? settleGrapple(getGrappleFacts(action), before) : before
    switch (phase) {
      case 'roll':
        if (c.id !== action.actorId || !action.cost) return c
        // combat.tex "Flee": the movement surge, made as a reaction
        if (action.kind === 'flee' || action.kind === 'fleeFollowUp') return actionSurge('movement')(c)
        if (action.kind === 'move' && action.movement === 'careful') return payCarefulMove(action.cost)(c)
        return payCost(action.cost)(c)
      case 'save':
        if (c.id !== action.actorId || action.kind !== 'cast' || !action.grazeSaved) return c
        return payCost(GRAZE_SAVE_COST)(c)
      case 'resolve':
        // combat.tex "Balance": a move on difficult terrain at a speed the
        // test did not clear ends in a fall
        // combat.tex "Movement": "Stand up: Removes the prone condition" —
        // unless an opportunity attack cancelled it ("Interruption")
        if (action.kind === 'move') {
          const trampled = trampledBy(action.facts?.trampled ?? [], c)
          if (c.id !== action.actorId) return trampled
          if (action.movement === 'stand') return action.facts?.stop === 'end' ? standUp(c) : c
          if (action.movement === 'prone') return fallProne(c)
          return action.facts?.fell ? fallProne(trampled) : trampled
        }
        // combat.tex "Explosions": what went off is gone — the thrower's row
        // left their hand, and the object a charge was set off in was
        // destroyed by it
        if (action.kind === 'explosion') {
          if (c.id === action.actorId && action.source === 'thrown') return releaseThrown(c, action.weaponKey, action.attack)
          if (action.source === 'detonate' && c.held.some((i) => i.id === action.itemId)) return consumeItem(action.itemId)(c)
          return c
        }
        // everyone in the area takes it, the attacker as much as anyone
        if (action.kind === 'blast') return deliverAll(action.facts?.[c.id] ?? [])(c)
        // spells.tex "Sustained": a cast that hit and did not fail is taken
        // hold of by its caster, its upkeep due at the round change;
        // "Effortless Spell": the caster rested while casting it
        if (action.kind === 'cast') {
          const landed = deliverAll(action.facts?.[c.id] ?? [])(c)
          if (c.id !== action.actorId || !isSpellKey(action.key) || action.roll?.degree !== 'hit' || action.failed) return landed
          const delivered = action.improved.effortless ? restWhileCasting(getEffortlessCost(landed, getCastSpentAP(action)))(landed) : landed
          const spell = SPELLS[action.key]
          if (spell.type === 'sustained' && !delivered.active.some((e) => e.kind === 'spell' && e.key === action.key)) {
            return { ...delivered, active: [...delivered.active, { kind: 'spell', key: action.key }] }
          }
          // spells.tex "Charged": "activates an object that stays charged"
          return spell.type === 'charged' ? chargeItem(action.key, action.improved)(delivered) : delivered
        }
        // spells.tex "Telepathic Link": what the test let through lands on
        // the target; the caster holds a link to one who did not beat the
        // linking spell's test, and loses one who beat any test the link
        // put them to
        if (action.kind === 'spellTest') {
          const delivered = deliverAll(action.facts?.[c.id] ?? [])(c)
          const link = isSpellKey(action.key) ? getLinkSpell(action.key) : null
          if (c.id !== action.actorId || !action.targetId || link === null) return delivered
          if (isSpellTestBeaten(action)) return unlinkTarget(link, action.targetId)(delivered)
          return link === action.key ? linkTarget(link, action.targetId)(delivered) : delivered
        }
        if (action.kind === 'rest') return c.id === action.actorId ? restCharacter(c) : c
        if (action.kind === 'pickUp') return c.id === action.actorId && action.picked ? holdItem(action.picked)(c) : c
        // combat.tex "Standard Action": a thrown item leaves whichever hand
        // it was thrown from; one thrown off the floor was never in it
        if (action.kind === 'throwItem') return c.id === action.actorId && action.thrown && c.held.some((i) => i.id === action.thrown!.id) ? dropItem(action.thrown.id)(c) : c
        if (!isAttackAction(action)) return c
        // spells.tex "Charged": the charge goes off with the blow that
        // lands — "discharges on the first object it comes into contact
        // with" — and leaves the object empty. A row that pierces has no
        // graze to land on (combat.tex "Piercing"), so it goes off or it
        // does not.
        // A purchase with a price of its own is paid as it lands (combat.tex
        // "Assassinate": "1 extra AP").
        if (c.id === action.actorId) {
          const charged = getChargedWeapon(c, action)
          const discharged = charged && action.roll && action.roll.degree !== 'miss' ? dischargeItem(charged.id)(c) : c
          const paid = HOP_PURCHASES.reduce((acc, p) => {
            const price = (action.spent[p] ?? 0) > 0 ? getHOPPrice(p, acc) : null
            return price ? payCost(price)(acc) : acc
          }, discharged)
          // combat.tex "Throw": what is thrown leaves the hand
          if (action.kind === 'shoot') return spendAmmo(releaseThrown(paid, action.weaponKey, action.attack), action.ammoId)
          // combat.tex "Braced Attack": the crash it triggers, the mover the
          // blow met against the bracer
          return action.trample ? trampledBy([action.trample], paid) : paid
        }
        if (c.id !== action.targetId || !action.facts) return c
        const struck = deliver(action.facts)(c)
        return action.kind === 'strike' && action.trample ? trampledBy([action.trample], struck) : struck
    }
  }
}

const fallProne = inflict(['prone'])
const standUp = cure(['prone'])

// combat.tex "Throw": a thrown row is made by letting go of the weapon; a
// natural weapon or a shooting one stays where it is.
function releaseThrown(c: CampaignCharacter, weaponKey: string, attack: string): CampaignCharacter {
  const row = findWeaponRow(c, weaponKey, attack)
  if (!row || row.wielded.natural || getAttackKind(row.atk.range) !== 'throw') return c
  return consumeItem(row.wielded.itemId)(c)
}

// gear.tex "Quiver": the shot takes one arrow or bolt from the stack it was
// loaded from, and it is gone.
function spendAmmo(c: CampaignCharacter, ammoId: string): CampaignCharacter {
  const stack = findAmmoStack(c, ammoId)
  return stack ? { ...c, containers: removeItemFromContainer(stack.containerKey, ammoId, 1)(c).containers } : c
}

// combat.tex "Grapple Maneuvers": what the maneuver did to the character
// beyond the grapple itself — knocked down, an item knocked out of their
// hand — and what the holds dealt them. The grappled and immobile
// afflictions follow the grapple, and are settled with it.
function settleGrapple(facts: GrappleFacts | null, c: CampaignCharacter): CampaignCharacter {
  if (!facts) return c
  const down = facts.prone.includes(c.id) ? fallProne(c) : c
  const disarmed = facts.dropped?.ownerId === c.id ? dropItem(facts.dropped.itemId)(down) : down
  return deliverAll(facts.deliveries[c.id] ?? [])(disarmed)
}

// The one place an action changes who is in a grapple with whom: the pair's
// grapple replaced with what the action left of it.
export function reduceGrapples(action: Action, phase: Phase): (grapples: Grapple[]) => Grapple[] {
  return (grapples: Grapple[]) => {
    if (phase !== 'resolve') return grapples
    // combat.tex "Push and drag": one who let go "and leave[s] the grapple"
    // instead of being moved
    if (action.kind === 'drag') {
      const released = action.facts?.released ?? []
      return released.length === 0 ? grapples : dropHolders(grapples, (id) => released.includes(id))
    }
    const facts = getGrappleFacts(action)
    return facts ? replacePair(grapples, facts.pair, facts.grapple) : grapples
  }
}

// The one place an action changes what lies on the floor: what a disarm
// knocked out of a hand, where its owner stands (combat.tex "Disarm"); what
// was thrown, one of it, where the throw was aimed; what was picked up,
// gone from it; what a standard-action throw moved, gone from wherever it
// lay and landed where it was aimed (combat.tex "Standard Action"). Read off
// the fight as it stood before the action landed.
export function reduceFloor(state: CombatState, action: Action, phase: Phase): (floor: FloorItem[]) => FloorItem[] {
  return (floor: FloorItem[]) => {
    if (phase !== 'resolve') return floor
    const cellOf = (id: string | null) => (id ? state.board?.placements[id]?.cell ?? null : null)
    if (action.kind === 'grapple' && action.facts?.dropped) {
      const { ownerId, itemId } = action.facts.dropped
      const owner = state.characters[ownerId]
      const item = owner ? getHeldItem(owner, itemId) : undefined
      return item ? [...floor, onFloor(item, cellOf(ownerId))] : floor
    }
    if (action.kind === 'shoot') return action.thrown ? [...floor, onFloor(action.thrown, cellOf(action.targetId))] : floor
    if (action.kind === 'pickUp') return floor.filter((f) => f.item.id !== action.itemId)
    // combat.tex "Standard Action": lands where it was thrown, gone from
    // wherever it lay before — a free hand leaves nothing behind on the floor
    if (action.kind === 'throwItem') return action.thrown ? [...floor.filter((f) => f.item.id !== action.itemId), onFloor(action.thrown, action.to)] : floor
    return floor
  }
}

// combat.tex "Crash": who it stunned, and the target it knocked prone —
// "Stun: An interrupt in which the target also loses 2 AP" — and, being
// interrupted, stops concentrating.
function trampledBy(tramples: Trample[], c: CampaignCharacter): CampaignCharacter {
  const hit = tramples.filter((t) => t.stunned.includes(c.id))
  if (hit.length === 0) return c
  const stunned = loseConcentration(payCost({ AP: STUN_AP * hit.length, STA: 0 })(c))
  return hit.some((t) => t.prone && t.id === c.id) ? fallProne(stunned) : stunned
}

// The one place an action changes the board, the same way: it reads the
// action and applies the part that moves anyone. Where a move ends was
// worked out from the fight as it stood at the resolve, so the board is
// handed the state it is part of.
export function reduceBoard(state: CombatState, action: Action, phase: Phase): (board: Board) => Board {
  return (board: Board) => {
    if (phase !== 'resolve') return board
    if (action.kind === 'move') {
      const placements = board.placements
      // a jump away from an opportunity attack put the mover where it landed
      const destination = action.facts && action.facts.stop !== 'jump' ? getMoveDestination(state, action, action.facts.path) : null
      return { ...board, placements: destination ? { ...placements, [action.actorId]: destination } : placements }
    }
    if (action.kind === 'strike') {
      // abilities.tex "Defender", "Defensive Advance": whoever stepped to
      // block or intercept stands where they stepped
      const stepped = Object.fromEntries(getReactionsTo(state, action.id).flatMap((r) => ((r.kind === 'block' || r.kind === 'intercept') && r.to ? [[r.actorId, r.to]] : [])))
      const placements = { ...board.placements, ...stepped }
      // combat.tex "Evasive Jump": the defender lands where the jump said
      if (!action.jumpedTo || !action.targetId) return { ...board, placements }
      return { ...board, placements: { ...placements, [action.targetId]: action.jumpedTo } }
    }
    // combat.tex "Push and drag": everyone moved where the block left them
    if (action.kind === 'drag') return action.facts ? { ...board, placements: { ...board.placements, ...action.facts.to } } : board
    // combat.tex "Gas": what the explosion leaves on the ground, by zone
    if (action.kind === 'blast') {
      const terrain = { ...board.terrain }
      for (const { cell, patch } of action.paint) {
        const key = coordKey(cell)
        const was = terrain[key] ?? TerrainCellSchema.parse({})
        terrain[key] = { ...was, visibility: patch.visibility ?? was.visibility, suffocating: was.suffocating || patch.suffocating }
      }
      return { ...board, terrain }
    }
    return board
  }
}
