import { ROUND_AP } from '../../tables'
import type { CampaignCharacter } from '../../types'
import { expireUsedAbilities } from '../../character/commands/abilities'
import { applyTrigger } from '../../character/commands/effects'
import { suffocate, bleed } from '../../character/commands/bleed'
import { burnAtRoundStart, burnScorch } from '../../character/commands/deliver'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { rollPercent, type Dice } from '../../play/dice'
import { actionSurge, endSurge } from '../../character/commands/actionSurge'
import { letGoOfSustained, payHeldSources } from '../../character/commands/spells'
import { cure } from '../../character/commands/addAffliction'
import { payCost } from '../../character/commands/cost'
import type { SceneState, Updater } from '../types'
import { getHazardOf } from '../rules/board/hazard'
import { isSuffocating } from '../rules/situational'
import { getMoraleCalled } from '../rules/morale'
import { getHeldCalled } from '../rules/heldTest'
import { getHeldActions } from '../rules/hold'
import { getConcentrationOwed, getContinueBar, getFinishing, getHoldOnBar, getLetGoBar, holdsThroughRound, needsFocusToHold } from '../rules/roundChange'
import { rollHeld } from './heldTest'
import { getRoundSeconds } from '../rules/chase'
import { endChaseRound } from './chase'
import { carryOver, finishHeld } from './hold'
import { updateCharacter } from './characters'

// The round change (rules/roundChange.ts has its order). `nextRound` opens
// it, `continueRound` moves it on a step at a time, and `holdOn` / `letGo`
// are each concentrating character's choice in its concentration step.

// combat.tex "End of the round": "reset to 8 AP minus any negative AP they
// had" — a surge's lost among what was left. What is left is kept until the
// AP are cut down to the round's, so a rest or a social action can be paid
// out of both rounds.
function receiveAP(c: CampaignCharacter): CampaignCharacter {
  const { resources } = endSurge(c)
  return { ...c, usedSurge: null, resources: { ...resources, AP: resources.AP + ROUND_AP } }
}

// combat.tex "End of the round": "Any unspent AP is lost."
function capAP(c: CampaignCharacter): CampaignCharacter {
  return c.resources.AP > ROUND_AP ? { ...c, resources: { ...c.resources, AP: ROUND_AP } } : c
}

// The round ends and the next one's change opens. Whoever fell in tanatosis
// wakes (creating.tex "Limit Stress Actions": "wakes up the next"). The round
// that ends adds the time it took, and a chase runs again. The swimming and
// stealth tests are called, and the stealth tests rolled as the round begins
// (the table's ruling). The first round has nothing to rest from, hold on to,
// lose or join: its AP start at the round's, and its change opens at the
// morale tests.
export function nextRound(dice: Dice): Updater {
  return (state) => {
    if (state.roundStep !== null) return state
    const receive = state.round === 0 ? (c: CampaignCharacter) => capAP(receiveAP(c)) : receiveAP
    const characters = Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, isDead(c) ? c : receive(wake(state, c))]))
    const begun: SceneState = { ...state, characters, round: state.round + 1, elapsed: state.round > 0 ? state.elapsed + getRoundSeconds(state) : state.elapsed, chase: endChaseRound(state), inTurnCharacter: '', fleeing: false, forcedSurge: '', turnQueue: [], fleers: [], contenders: [], lastContest: null, agreedToEnd: [], morale: [], heldTests: [], turnsTaken: [], prepared: [], stealthTurns: [], compulsions: [], concentration: [], roundStep: 'rest' }
    const called = rollStealth({ ...begun, heldTests: getHeldCalled(begun) }, dice)
    return state.round === 0 ? continueRound(dice)(continueRound(dice)(called)) : called
  }
}

function wake(state: SceneState, c: CampaignCharacter): CampaignCharacter {
  return state.compulsions.some((t) => t.id === c.id && t.action === 'tanatosis') ? cure(['unconscious'])(c) : c
}

// The stealth tests the round calls, rolled as it begins (the table's ruling).
function rollStealth(state: SceneState, dice: Dice): SceneState {
  return state.heldTests.filter((t) => t.kind === 'stealth').reduce((s, t) => rollHeld(t.id, 'stealth', 'normal', dice)(s), state)
}

// The round change moves on to its next step, once the one it is at has
// nothing owed.
export function continueRound(dice: Dice): Updater {
  return (state) => {
    if (getContinueBar(state)) return state
    switch (state.roundStep) {
      case 'rest': return openConcentration(passEnvironment(state), dice)
      case 'concentration': return { ...state, roundStep: 'join' }
      case 'join': return { ...state, roundStep: 'morale', morale: getMoraleCalled(state).map((id) => ({ id, roll: null })) }
      case 'morale': return { ...state, roundStep: null }
      default: return state
    }
  }
}

// combat.tex "Bleed": "+1 to their IL per bleed intensity at the end of
// every round in combat", unless First Aid staunched it for the round. Then
// what the ground does to whoever stands in it: the fire touched in a turn the
// round change ended burns, and then the counter burns with the fire they
// stand in added, as one instance (combat.tex "Burning", "Fire"); not being
// able to breathe costs its STA. A dead character has nothing left to bleed
// out or burn.
function passEnvironment(state: SceneState): SceneState {
  return Object.values(state.characters).filter((c) => !isDead(c)).reduce((s, c) => {
    const bled = updateCharacter(c.id, (x) => {
      const out = bleed(1)(x)
      return out.injuries.staunched ? { ...out, injuries: { ...out.injuries, staunched: false } } : out
    }, 'bleeding')(s)
    const fire = getHazardOf(state, c.id).fire
    const suffocating = isSuffocating(state, c)
    return updateCharacter(c.id, (x) => {
      const burnt = burnAtRoundStart(fire)(burnScorch(x))
      return suffocating ? suffocate(burnt) : burnt
    }, 'environment')(bled)
  }, state)
}

// The AP are cut down to the round's, and whoever keeps nothing going through
// the round change pays what falls due on it, a fired ability spent with it.
// Whoever can no longer act lets go of what they held. With nobody left to
// choose, the change moves on to who joins.
function openConcentration(state: SceneState, dice: Dice): SceneState {
  const settled = Object.values(state.characters).filter((c) => !isDead(c)).reduce<SceneState>((s, c) => {
    const capped = updateCharacter(c.id, capAP, 'unspent AP lost')(s)
    if (!holdsThroughRound(capped, c.id)) return updateCharacter(c.id, payRoundEnd, 'round end')(capped)
    return hasAffliction(c, 'unconscious') ? letGoOf(capped, c.id, dice) : capped
  }, { ...state, roundStep: 'concentration' })
  return getConcentrationOwed(settled).length === 0 && getFinishing(settled).length === 0 ? { ...settled, roundStep: 'join' } : settled
}

function payRoundEnd(c: CampaignCharacter): CampaignCharacter {
  return expireUsedAbilities(applyTrigger('end_round')(c))
}

// spells.tex "Sustained Spells": "The cost must be paid at the beginning of
// the next round to maintain the spell effect" — the charges a held spell
// draws from its item, letting go of one that has none left, and then the
// upkeep of everything kept going; a held spell or a held action takes the
// focus surge holding it does (the table's ruling), and a held action keeps
// every AP left for itself (combat.tex "Concentration").
export function holdOn(id: string, dice: Dice): Updater {
  return (state) => {
    if (getHoldOnBar(state, id)) return state
    const focus = needsFocusToHold(state, id)
    const paid = updateCharacter(id, (c) => {
      const kept = payRoundEnd(payHeldSources(() => rollPercent(dice))(c))
      return focus ? actionSurge('focus')(kept) : kept
    }, 'holds on')(state)
    const held = getHeldActions(paid).find((h) => h.actorId === id)
    const pool = Math.max(0, paid.characters[id].resources.AP)
    const carried = held ? carryOver(updateCharacter(id, payCost({ AP: pool, STA: 0 }), 'holds on')(paid), held, pool) : paid
    return settleChoices({ ...carried, concentration: [...carried.concentration, { id, hold: true }] }, dice)
  }
}

// spells.tex "Sustained Spells": a held spell is let go of at will; so is an
// ability kept switched on. What falls due on the round change is paid all
// the same, and an action held over is finished, if its AP are there for it.
export function letGo(id: string, dice: Dice): Updater {
  return (state) => (getLetGoBar(state, id) ? state : letGoOf(state, id, dice))
}

function letGoOf(state: SceneState, id: string, dice: Dice): SceneState {
  const released = updateCharacter(id, (c) => payRoundEnd(letGoOfSustained(c)), 'lets go')(state)
  return settleChoices({ ...released, concentration: [...released.concentration, { id, hold: false }] }, dice)
}

// Once nobody owes a choice, the held actions let go of are finished, in
// their order.
function settleChoices(state: SceneState, dice: Dice): SceneState {
  if (getConcentrationOwed(state).length > 0) return state
  const letGoBy = state.concentration.filter((x) => !x.hold).map((x) => x.id)
  const finishing = getHeldActions(state).filter((h) => letGoBy.includes(h.actorId) && h.finishing === null).map((h) => h.id)
  return finishing.length === 0 ? state : finishHeld(state, finishing, dice)
}
