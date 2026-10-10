import type { CampaignCharacter } from '../../types'
import type { SceneState, Updater } from '../types'
import type { ChaseTier } from '../../lists'
import { SURGES } from '../../tables'
import { rollPercent, type Dice } from '../../play/dice'
import { actionSurge } from '../../character/commands/actionSurge'
import { bleed } from '../../character/commands/bleed'
import { getChaseSide, getChaseStartBar, getChaseWays, getRunBar, getRunners, getRunSpeed, getSideSpeed, isOutrun, stepTier, type ChaseWay } from '../rules/chase'
import { getFightBusy } from '../rules/turn'
import { updateCharacter } from './characters'

// combat.tex "Chases": these fight parties run away from everyone else, at
// the tier the table sets ("Approach": "The weapon range will decide at what
// distance both teams start").
export function startChase(quarry: string[], tier: ChaseTier): Updater {
  return (state) => getChaseStartBar(state, quarry, tier) ? state : { ...state, chase: { quarry, tier, run: null, escaped: false, turned: [] } }
}

// combat.tex "Running": what a run takes from each runner — a dash their
// movement surge; a sustained pace, from one who bleeds, the bleed of "an
// action surge" (each costs the same STA).
function pay(tier: ChaseTier): (c: CampaignCharacter) => CampaignCharacter {
  return tier === 'combat' ? actionSurge('movement') : bleed(SURGES.movement.STA)
}

// combat.tex "Running": both sides run at their slowest member's speed and
// every member pays for it. "A draw does not change distance tier" at combat
// range; at longer ranges "50% chance on a draw".
export function runChase(dice: Dice): Updater {
  return (state) => {
    const chase = state.chase
    if (!chase || getRunBar(state)) return state
    const { tier } = chase
    const quarry = getRunners(state, 'quarry')
    const pursuers = getRunners(state, 'pursuers')
    const speeds = Object.fromEntries([...quarry, ...pursuers].map((c) => [c.id, getRunSpeed(c, tier)]))
    const q = getSideSpeed(quarry, tier)
    const p = getSideSpeed(pursuers, tier)
    const coin = q === p && tier !== 'combat' ? rollPercent(dice) : null
    const winner = q > p ? 'quarry' : p > q ? 'pursuers' : coin === null ? null : coin < 50 ? 'quarry' : 'pursuers'
    const paid = [...quarry, ...pursuers].reduce((s: SceneState, c) => updateCharacter(c.id, pay(tier), 'chase run')(s), state)
    return { ...paid, chase: { ...chase, run: { tier, speeds, quarry: q, pursuers: p, winner, coin, chosen: winner === null } } }
  }
}

// The winner of the run says which way the distance goes: a tier nearer or
// farther, and farther from far or horizon is the quarry getting away.
export function chooseChaseWay(way: ChaseWay): Updater {
  return (state) => {
    const chase = state.chase
    if (!chase?.run || !getChaseWays(state).includes(way)) return state
    const escaped = isOutrun(chase.tier, way)
    return { ...state, chase: { ...chase, tier: escaped ? chase.tier : stepTier(chase.tier, way), escaped, run: { ...chase.run, chosen: true } } }
  }
}

// The chase is over and the scene goes on as a fight (combat.tex "Catching":
// "a combat or social situation starts").
export const endChase: Updater = (state) => (!state.chase || getFightBusy(state) ? state : { ...state, chase: null })

// combat.tex "Catching": one of the quarry turns around to face the
// pursuers, or thinks better of it before the table ends the chase.
export function turnAround(id: string): Updater {
  return (state) => {
    const chase = state.chase
    if (!chase || chase.escaped || !state.characters[id] || getChaseSide(state, id) !== 'quarry') return state
    const turned = chase.turned.includes(id) ? chase.turned.filter((t) => t !== id) : [...chase.turned, id]
    return { ...state, chase: { ...chase, turned } }
  }
}
