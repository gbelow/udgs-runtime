import type { CampaignCharacter } from '../types'
import type { Action, Board, CombatState } from './types'
import { payCost } from '../character/commands/cost'
import { deliver } from '../character/commands/deliver'
import { chargeItem } from '../item/commands/hands'
import { throwItem } from '../item/commands/hands'
import { getWieldedWeapons } from '../item/lenses/hands'
import { getAttackKind } from '../weaponProperties'
import { getMoveDestination } from './lenses/move'
import { getReactionsTo } from './lenses/action'
import { getTerrainPaint } from './lenses/explosion'
import { coordKey } from './geometry'
import { SPELLS, isSpellKey } from '../spells'
import { TerrainCellSchema } from './types'

// The two moments an action touches a character: `roll`, when the die is
// thrown and the price leaves the actor in the same step, and `resolve`, when
// what the action did lands on whoever it was done to.
export type Phase = 'roll' | 'resolve'

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
      case 'resolve':
        // combat.tex "Balance": a move on difficult terrain at a speed the
        // test did not clear ends in a fall
        if (action.kind === 'move') return c.id === action.actorId && action.facts?.fell ? fallProne(c) : c
        // combat.tex "Explosions": everyone in the area takes it, the
        // attacker as much as anyone — and what they threw is out of their
        // hands
        if (action.kind === 'explosion') {
          const hit = (action.facts?.[c.id] ?? []).reduce((acc, d) => deliver(d)(acc), c)
          return c.id === action.actorId && action.source === 'thrown' ? releaseThrown(hit, action.weaponKey, action.attack) : hit
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
          return spell.type === 'charged' ? chargeItem(action.key)(delivered) as CampaignCharacter : delivered
        }
        if ((action.kind !== 'strike' && action.kind !== 'shoot') || c.id !== action.targetId || !action.facts) return c
        return deliver(action.facts)(c)
    }
  }
}

// combat.tex "Throw": a thrown row is made by letting go of the weapon; a
// natural weapon or a shooting one stays where it is.
function releaseThrown(c: CampaignCharacter, weaponKey: string, attack: string): CampaignCharacter {
  const wielded = getWieldedWeapons(c).find((w) => w.key === weaponKey)
  const atk = wielded?.weapon.attacks.find((a) => a.name === attack)
  if (!wielded || wielded.natural || !atk || getAttackKind(atk.range) !== 'throw') return c
  return throwItem(wielded.itemId)(c) as CampaignCharacter
}

function fallProne(c: CampaignCharacter): CampaignCharacter {
  return { ...c, afflictions: [...new Set([...c.afflictions, 'prone' as const])] }
}

// The one place an action changes the board, the same way: it reads the
// action and applies the part that moves anyone. Where a move ends was
// worked out from the fight as it stood at the resolve, so the board is
// handed the state it is part of.
export function reduceBoard(state: CombatState, action: Action, phase: Phase): (board: Board) => Board {
  return (board: Board) => {
    if (phase !== 'resolve') return board
    if (action.kind === 'move') {
      // a jump away from an opportunity attack put the mover where it landed
      if (action.facts?.stop === 'jump') return board
      const destination = action.facts ? getMoveDestination(state, action, action.facts.path) : null
      if (!destination) return board
      return { ...board, placements: { ...board.placements, [action.actorId]: destination } }
    }
    if (action.kind === 'strike') {
      // combat.tex "Evasive Jump": the defender lands where the jump said
      const jump = getReactionsTo(state, action.id).find((r) => r.kind === 'evasiveJump')
      if (!jump || jump.kind !== 'evasiveJump' || !jump.to) return board
      return { ...board, placements: { ...board.placements, [jump.actorId]: jump.to } }
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
