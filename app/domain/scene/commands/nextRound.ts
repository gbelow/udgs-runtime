import { ROUND_AP } from '../../tables'
import type { CampaignCharacter } from '../../types'
import { expireUsedAbilities } from '../../character/commands/abilities'
import { applyTrigger } from '../../character/commands/effects'
import { suffocate, bleed } from '../../character/commands/bleed'
import { burnAtRoundStart, burnScorch } from '../../character/commands/deliver'
import { isDead } from '../../character/rules/afflictions'
import { rollPercent, type Dice } from '../../play/dice'
import { isConcentrating } from '../../character/rules/concentration'
import { canSurge } from '../../character/rules/surge'
import { actionSurge, endSurge } from '../../character/commands/actionSurge'
import { loseConcentration, payHeldSources } from '../../character/commands/spells'
import type { SceneState } from '../types'
import { getHazardOf } from '../rules/board/hazard'
import { isSuffocating } from '../rules/situational'
import { getMoraleCalled } from '../rules/morale'
import { getHeldCalled } from '../rules/heldTest'
import { getHold, getUpkeepAims } from '../rules/fireAgain'
import { makeAction } from '../factories'
import { cure } from '../../character/commands/addAffliction'
import { appendActions } from './log'
import { rollHeld } from './heldTest'
import { getRoundSeconds } from '../rules/chase'
import { endChaseRound } from './chase'

// combat.tex "End of the round": "reset to 8 AP minus any negative AP they
// had. Any unspent AP is lost." — a surge's among it.
function resetAP(c: CampaignCharacter): CampaignCharacter {
  const { resources } = endSurge(c)
  return { ...c, resources: { ...resources, AP: Math.min(ROUND_AP, resources.AP + ROUND_AP) } }
}

// Everything due at the round change lands on each character — the charges
// a held spell draws from its item, letting go of one that has none left,
// then the upkeep of what is still held on or was fired this round; the
// fire touched in a turn the round change ended burns, and then the counter
// burns with the fire they stand in added, as one instance (combat.tex
// "Burning", "Fire"); not being able to breathe costs its STA. A fired
// ability is then spent, the bleed runs on (combat.tex "Bleed": +1 IL per
// bleed intensity at the end of every round in combat) unless First Aid
// staunched it for the round, the surge used this
// round is cleared and the AP reset. Whoever still holds a spell makes the
// focus surge holding it takes (the table's ruling), or lets go of it when
// they cannot. Whoever fell in tanatosis wakes (creating.tex "Limit Stress
// Actions": "wakes up the next"). A dead character has nothing left to pay or
// bleed out further.
function endRound(state: SceneState, c: CampaignCharacter, dice: Dice): CampaignCharacter {
  if (isDead(c)) return c
  const burnt = burnAtRoundStart(getHazardOf(state, c.id).fire)(burnScorch(applyTrigger('end_round')(payHeldSources(() => rollPercent(dice))(c))))
  const spent = expireUsedAbilities(burnt)
  const bled = bleed(1)(isSuffocating(state, c) ? suffocate(spent) : spent)
  const due = bled.injuries.staunched ? { ...bled, injuries: { ...bled.injuries, staunched: false } } : bled
  const woken = state.compulsions.some((t) => t.id === c.id && t.action === 'tanatosis') ? cure(['unconscious'])(due) : due
  const reset = resetAP({ ...woken, usedSurge: null })
  if (!isConcentrating(reset)) return reset
  return canSurge('focus')(reset) ? actionSurge('focus')(reset) : loseConcentration(reset)
}

// combat.tex "Environmental and ongoing effects": "applied at the beginning
// of the round", to whoever stands in them as the ground is now. combat.tex
// "Morale": the round begins by calling to a test whoever the fight, as the
// round change left it, puts under enough stress. The upkeep a holder paid
// for a spray gives them a free aim of it (the table's ruling): the ground
// moves, nobody is harmed, and the fight waits on it like on a morale test.
// The round that ends adds the time it took, and a chase runs again.
export function nextRound(dice: Dice, newId: () => string): (state: SceneState) => SceneState {
  return (state) => {
    const characters = Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, endRound(state, c, dice)]))
    const next = { ...state, characters, round: state.round + 1, elapsed: state.round > 0 ? state.elapsed + getRoundSeconds(state) : state.elapsed, chase: endChaseRound(state), inTurnCharacter: '', fleeing: false, forcedSurge: '', turnQueue: [], fleers: [], contenders: [], lastContest: null, agreedToEnd: [], morale: [], heldTests: [], turnsTaken: [], prepared: [], stealthTurns: [], compulsions: [] }
    const called = rollStealth({ ...next, morale: getMoraleCalled(next).map((id) => ({ id, roll: null })), heldTests: getHeldCalled(next) }, dice)
    return appendActions(called, getUpkeepAims(called).map(({ actorId, key }) => makeAction('fireAgain', { id: newId(), actorId, key, ...getHold(called, called.characters[actorId], key), upkeep: true, step: 'react' })))
  }
}

// The stealth tests the round calls, rolled as it begins (the table's ruling).
function rollStealth(state: SceneState, dice: Dice): SceneState {
  return state.heldTests.filter((t) => t.kind === 'stealth').reduce((s, t) => rollHeld(t.id, 'stealth', 'normal', dice)(s), state)
}
