import type { CampaignCharacter } from '../types'
import type { Action, Board, CombatState, Trample } from './types'
import { payCost } from '../character/commands/cost'
import { deliver } from '../character/commands/deliver'
import { chargeItem, consumeItem, dischargeItem } from '../item/commands/hands'
import { getWieldedWeapons } from '../item/rules/hands'
import { getAttackKind } from '../weaponProperties'
import { getMoveDestination } from './rules/move'
import { getReactionsTo } from './rules/action'
import { getChargedItem, getHOPPrice } from './rules/damage'
import { HOP_PURCHASES } from '../lists'
import { getTerrainPaint } from './rules/explosion'
import { coordKey } from './geometry'
import { SPELLS, isSpellKey } from '../spells'
import { TerrainCellSchema } from './types'
import { GRAZE_SAVE, STUN_AP } from '../tables'

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
  return (c: CampaignCharacter) => {
    switch (phase) {
      case 'roll':
        if (c.id !== action.actorId || !action.cost) return c
        // a spell's price is the whole of what it asks (spells.tex "Casting
        // spells"), not only the AP and STA the fight prices
        if (action.kind === 'cast' && isSpellKey(action.key)) return payCost(SPELLS[action.key].cost)(c)
        return payCost({ ...action.cost, exhaustion: 0, IL: 0, ET: 0 })(c)
      case 'save':
        if (c.id !== action.actorId || action.kind !== 'cast' || !action.grazeSaved) return c
        return payCost({ AP: GRAZE_SAVE.AP, STA: 0, exhaustion: 0, IL: 0, ET: 0 })(c)
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
        // combat.tex "Explosions": everyone in the area takes it, the
        // attacker as much as anyone — and what they threw is out of their
        // hands
        if (action.kind === 'explosion') {
          const hit = (action.facts?.[c.id] ?? []).reduce((acc, d) => deliver(d)(acc), c)
          // what went off is gone: the thrower's row left their hand, and
          // the object a charge was set off in was destroyed by it
          if (c.id === action.actorId && action.source === 'thrown') return releaseThrown(hit, action.weaponKey, action.attack)
          if (action.source === 'detonate' && hit.held.some((i) => i.id === action.itemId)) return consumeItem(action.itemId)(hit) as CampaignCharacter
          return hit
        }
        // spells.tex "Sustained": a cast that hit is taken hold of by its
        // caster, its upkeep due at the round change
        if (action.kind === 'cast') {
          const delivered = (action.facts?.[c.id] ?? []).reduce((acc, d) => deliver(d)(acc), c)
          if (c.id !== action.actorId || !isSpellKey(action.key) || action.roll?.degree !== 'hit') return delivered
          const spell = SPELLS[action.key]
          if (spell.type === 'sustained' && !delivered.active.some((e) => e.kind === 'spell' && e.key === action.key)) {
            return { ...delivered, active: [...delivered.active, { kind: 'spell', key: action.key }] }
          }
          // spells.tex "Charged": "activates an object that stays charged"
          return spell.type === 'charged' ? chargeItem(action.key, action.improved)(delivered) as CampaignCharacter : delivered
        }
        if (action.kind !== 'strike' && action.kind !== 'shoot') return c
        // spells.tex "Charged": the charge goes off with the blow that
        // lands — "discharges on the first object it comes into contact
        // with" — and leaves the object empty. A row that pierces has no
        // graze to land on (combat.tex "Piercing"), so it goes off or it
        // does not.
        // A purchase with a price of its own is paid as it lands (combat.tex
        // "Assassinate": "1 extra AP").
        if (c.id === action.actorId) {
          const charged = getChargedItem(c, action)
          const discharged = charged && action.roll && action.roll.degree !== 'miss' ? dischargeItem(charged.id)(c) as CampaignCharacter : c
          const paid = HOP_PURCHASES.reduce((acc, p) => {
            const price = (action.spent[p] ?? 0) > 0 ? getHOPPrice(p, acc) : null
            return price ? payCost({ ...price, exhaustion: 0, IL: 0, ET: 0 })(acc) : acc
          }, discharged)
          // combat.tex "Braced Attack": the trample it triggers, the bracer
          // against the mover the blow met (its target)
          return action.kind === 'strike' && action.trample ? trampledBy([action.trample], action.targetId ?? '', paid) : paid
        }
        if (c.id !== action.targetId || !action.facts) return c
        const struck = deliver(action.facts)(c)
        const braced = action.kind === 'strike' && action.trample ? trampledBy([action.trample], c.id, struck) : struck
        // combat.tex "Trip": "the target falls and is prone"
        return action.kind === 'strike' && action.tripped ? fallProne(braced) : braced
    }
  }
}

// combat.tex "Throw": a thrown row is made by letting go of the weapon; a
// natural weapon or a shooting one stays where it is.
function releaseThrown(c: CampaignCharacter, weaponKey: string, attack: string): CampaignCharacter {
  const wielded = getWieldedWeapons(c).find((w) => w.key === weaponKey)
  const atk = wielded?.weapon.attacks.find((a) => a.name === attack)
  if (!wielded || wielded.natural || !atk || getAttackKind(atk.range) !== 'throw') return c
  return consumeItem(wielded.itemId)(c) as CampaignCharacter
}

function fallProne(c: CampaignCharacter): CampaignCharacter {
  return { ...c, afflictions: [...new Set([...c.afflictions, 'prone' as const])] }
}

// combat.tex "Trample": whoever loses is stunned — the runner "stopped and
// stunned", the opponent "moves back one space and is stunned", or "stunned
// and prone" — and "Stun: An interrupt in which the target also loses 2 AP".
// A mover who pushes someone along their heading meets them again on every
// step, but it is one stun for the whole move (the table's ruling).
function trampledBy(tramples: Trample[], runnerId: string, c: CampaignCharacter): CampaignCharacter {
  const lost = tramples.filter((t) => (t.result === 'stopped' ? runnerId : t.id) === c.id)
  if (lost.length === 0) return c
  const stunned = { ...c, resources: { ...c.resources, AP: c.resources.AP - STUN_AP } }
  return lost.some((t) => t.result === 'knocked') ? fallProne(stunned) : stunned
}

// Where each trample pushed whoever lost it, the last push standing.
function pushedBy(tramples: Trample[], placements: Board['placements']): Board['placements'] {
  return tramples.reduce((acc, t) => (t.to ? { ...acc, [t.id]: t.to } : acc), placements)
}

function standUp(c: CampaignCharacter): CampaignCharacter {
  return { ...c, afflictions: c.afflictions.filter((a) => a !== 'prone') }
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
      const jump = getReactionsTo(state, action.id).find((r) => r.kind === 'evasiveJump')
      if (!jump || jump.kind !== 'evasiveJump' || !jump.to) return { ...board, placements }
      return { ...board, placements: { ...placements, [jump.actorId]: jump.to } }
    }
    // combat.tex "Gas": what the explosion leaves on the ground, by zone
    if (action.kind === 'explosion') {
      const terrain = { ...board.terrain }
      for (const { cell, patch } of getTerrainPaint(state, action)) {
        const key = coordKey(cell)
        const was = terrain[key] ?? TerrainCellSchema.parse({})
        terrain[key] = { ...was, visibility: patch.visibility ?? was.visibility, suffocating: was.suffocating || patch.suffocating }
      }
      return { ...board, terrain }
    }
    return board
  }
}
