import type { CampaignCharacter } from '../../types'
import { TerrainCellSchema, type Action, type Board, type CombatState, type FloorItem, type Grapple, type GrappleFacts, type Trample } from '../types'
import { payCost } from '../../character/commands/cost'
import { cure, inflict } from '../../character/commands/addAffliction'
import { deliver, deliverAll } from '../../character/commands/deliver'
import { chargeItem, consumeItem, dischargeItem, dropItem, holdItem } from '../../item/commands/hands'
import { getHeldItem } from '../../item/rules/hands'
import { findWeaponRow } from '../rules/weaponRow'
import { getAttackKind } from '../../weaponProperties'
import { onFloor } from '../rules/floor'
import { getMoveDestination } from '../rules/move'
import { isAttackAction } from '../rules/attack'
import { getChargedWeapon, getHOPPrice } from '../rules/damage'
import { HOP_PURCHASES } from '../../lists'
import { dropHolders, getGrappleFacts, replacePair } from '../rules/grapple'
import { coordKey } from '../geometry'
import { SPELLS, isSpellKey } from '../../spells'
import { STUN_AP } from '../../tables'
import { GRAZE_SAVE_COST } from '../rules/cast'

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
export function reduceCharacter(action: Action, phase: Phase): (c: CampaignCharacter) => CampaignCharacter {
  return (before: CampaignCharacter) => {
    const c = phase === 'resolve' ? settleGrapple(getGrappleFacts(action), before) : before
    switch (phase) {
      case 'roll':
        if (c.id !== action.actorId || !action.cost) return c
        return payCost(action.cost)(c)
      case 'save':
        if (c.id !== action.actorId || action.kind !== 'cast' || !action.grazeSaved) return c
        return payCost(GRAZE_SAVE_COST)(c)
      case 'resolve':
        // combat.tex "Balance": a move on difficult terrain at a speed the
        // test did not clear ends in a fall
        // combat.tex "Movement": "getting up: Removes the prone condition" —
        // unless an opportunity attack cancelled it ("Interruption")
        if (action.kind === 'move') {
          const trampled = trampledBy(action.facts?.trampled ?? [], action.actorId, c)
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
          if (action.source === 'detonate' && c.held.some((i) => i.id === action.itemId)) return consumeItem(action.itemId)(c) as CampaignCharacter
          return c
        }
        // everyone in the area takes it, the attacker as much as anyone
        if (action.kind === 'blast') return deliverAll(action.facts?.[c.id] ?? [])(c)
        // spells.tex "Sustained": a cast that hit is taken hold of by its
        // caster, its upkeep due at the round change
        if (action.kind === 'cast') {
          const delivered = deliverAll(action.facts?.[c.id] ?? [])(c)
          if (c.id !== action.actorId || !isSpellKey(action.key) || action.roll?.degree !== 'hit') return delivered
          const spell = SPELLS[action.key]
          if (spell.type === 'sustained' && !delivered.active.some((e) => e.kind === 'spell' && e.key === action.key)) {
            return { ...delivered, active: [...delivered.active, { kind: 'spell', key: action.key }] }
          }
          // spells.tex "Charged": "activates an object that stays charged"
          return spell.type === 'charged' ? chargeItem(action.key, action.improved)(delivered) as CampaignCharacter : delivered
        }
        // combat.tex "Push and drag": going along passively is paid for in
        // the basic movement of the metres moved
        if (action.kind === 'displace') {
          const AP = action.facts?.carried[c.id] ?? 0
          return AP > 0 ? payCost({ AP, STA: 0 })(c) : c
        }
        if (action.kind === 'pickUp') return c.id === action.actorId && action.picked ? holdItem(action.picked)(c) as CampaignCharacter : c
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
          const discharged = charged && action.roll && action.roll.degree !== 'miss' ? dischargeItem(charged.id)(c) as CampaignCharacter : c
          const paid = HOP_PURCHASES.reduce((acc, p) => {
            const price = (action.spent[p] ?? 0) > 0 ? getHOPPrice(p, acc) : null
            return price ? payCost(price)(acc) : acc
          }, discharged)
          // combat.tex "Throw": what is thrown leaves the hand
          if (action.kind === 'shoot') return releaseThrown(paid, action.weaponKey, action.attack)
          // combat.tex "Braced Attack": the trample it triggers, the bracer
          // against the mover the blow met (its target)
          return action.trample ? trampledBy([action.trample], action.targetId ?? '', paid) : paid
        }
        if (c.id !== action.targetId || !action.facts) return c
        const struck = deliver(action.facts)(c)
        const braced = action.kind === 'strike' && action.trample ? trampledBy([action.trample], c.id, struck) : struck
        // combat.tex "Trip": "the target falls and is prone"
        return action.kind === 'strike' && action.tripped ? fallProne(braced) : braced
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
  return consumeItem(row.wielded.itemId)(c) as CampaignCharacter
}

// combat.tex "Grapple Maneuvers": what the maneuver did to the character
// beyond the grapple itself — knocked down or stood up, an item knocked out
// of their hand — and what the holds dealt them. The grappled and immobile
// afflictions follow the grapple, and are settled with it.
function settleGrapple(facts: GrappleFacts | null, c: CampaignCharacter): CampaignCharacter {
  if (!facts) return c
  const down = facts.prone.includes(c.id) ? fallProne(c) : facts.stand.includes(c.id) ? standUp(c) : c
  const disarmed = facts.dropped?.ownerId === c.id ? dropItem(facts.dropped.itemId)(down) as CampaignCharacter : down
  return deliverAll(facts.deliveries[c.id] ?? [])(disarmed)
}

// The one place an action changes who is in a grapple with whom: the pair's
// grapple replaced with what the action left of it.
export function reduceGrapples(action: Action, phase: Phase): (grapples: Grapple[]) => Grapple[] {
  return (grapples: Grapple[]) => {
    if (phase !== 'resolve') return grapples
    // combat.tex "Push and drag": one who let go instead of being dragged
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
// gone from it. Read off the fight as it stood before the action landed.
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
    return floor
  }
}

// combat.tex "Trample": whoever loses is stunned — the runner "stopped and
// stunned", the opponent "moves back one space and is stunned", or "stunned
// and prone" — and "Stun: An interrupt in which the target also loses 2 AP".
// A mover who pushes someone along their heading meets them again on every
// step, but it is one stun for the whole move (the table's ruling).
function trampledBy(tramples: Trample[], runnerId: string, c: CampaignCharacter): CampaignCharacter {
  const lost = tramples.filter((t) => (t.result === 'stopped' ? runnerId : t.id) === c.id)
  if (lost.length === 0) return c
  const stunned = payCost({ AP: STUN_AP, STA: 0 })(c)
  return lost.some((t) => t.result === 'knocked') ? fallProne(stunned) : stunned
}

// Where each trample pushed whoever lost it, the last push standing.
function pushedBy(tramples: Trample[], placements: Board['placements']): Board['placements'] {
  return tramples.reduce((acc, t) => (t.to ? { ...acc, [t.id]: t.to } : acc), placements)
}

// The one place an action changes the board, the same way: it reads the
// action and applies the part that moves anyone. Where a move ends was
// worked out from the fight as it stood at the resolve, so the board is
// handed the state it is part of.
export function reduceBoard(state: CombatState, action: Action, phase: Phase): (board: Board) => Board {
  return (board: Board) => {
    if (phase !== 'resolve') return board
    // combat.tex "Trample": "the opponent moves back one space"
    if (action.kind === 'move') {
      const placements = pushedBy(action.facts?.trampled ?? [], board.placements)
      // a jump away from an opportunity attack put the mover where it landed
      const destination = action.facts && action.facts.stop !== 'jump' ? getMoveDestination(state, action, action.facts.path) : null
      return { ...board, placements: destination ? { ...placements, [action.actorId]: destination } : placements }
    }
    if (action.kind === 'strike') {
      const placements = pushedBy(action.trample ? [action.trample] : [], board.placements)
      // combat.tex "Evasive Jump": the defender lands where the jump said
      if (!action.jumpedTo || !action.targetId) return { ...board, placements }
      return { ...board, placements: { ...placements, [action.targetId]: action.jumpedTo } }
    }
    // combat.tex "Push and drag": the pair where the push left them
    if (action.kind === 'displace') return action.facts ? { ...board, placements: { ...board.placements, ...action.facts.to } } : board
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
