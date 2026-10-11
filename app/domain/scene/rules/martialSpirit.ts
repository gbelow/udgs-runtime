import type { Delivery } from '../../types'
import type { StrikeAction, SceneState } from '../types'
import { ABILITIES, hasAbility } from '../../abilities'
import { produceSpiritAttack } from '../../character/rules/spirit'
import type { ActionCost } from '../../character/rules/actionCosts'
import { isSweepLink } from './sweep'

// abilities.tex "Martial Spirit": "use spiritual strike along with melee
// attacks without increasing the cost of AP, but with the STA cost added in.
// The spellcasting result is the same as the strike's."

const MARTIAL_SPIRIT = 'martial-spirit'

// Whether the strike may carry a spiritual attack: its attacker learned
// Martial Spirit, and it is not a later strike of a sweep — the attack goes
// with the blow that was declared, once.
export function canStrikeWithSpirit(state: SceneState, strike: StrikeAction): boolean {
  const c = state.characters[strike.actorId]
  return !!c && hasAbility(c, MARTIAL_SPIRIT) && !isSweepLink(strike)
}

// What it adds to the strike's price: the ability's STA, no AP.
export function getMartialSpiritCost(): ActionCost {
  return { AP: 0, STA: ABILITIES[MARTIAL_SPIRIT].cost.STA }
}

// The spiritual attack a strike declared with it carries, on a hit only: a
// cast's graze does nothing, and the strike's result is the cast's.
export function getStrikeSpirit(state: SceneState, strike: StrikeAction): Delivery[] {
  const c = state.characters[strike.actorId]
  return c && strike.targetId && strike.martialSpirit && strike.roll?.degree === 'hit' && canStrikeWithSpirit(state, strike) ? [produceSpiritAttack(c)] : []
}
