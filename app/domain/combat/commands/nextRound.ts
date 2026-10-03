import { ROUND_AP } from '../../tables'
import type { CampaignCharacter } from '../../types'
import { expireUsedAbilities } from '../../character/commands/abilities'
import { applyTrigger } from '../../character/commands/effects'
import { suffocate, bleed } from '../../character/commands/bleed'
import { burnAtRoundStart, burnScorch } from '../../character/commands/deliver'
import { isDead } from '../../character/rules/afflictions'
import { rollPercent, type Dice } from '../dice'
import { isConcentrating } from '../../character/rules/concentration'
import { canSurge } from '../../character/rules/surge'
import { actionSurge } from '../../character/commands/actionSurge'
import { loseConcentration, payHeldSources } from '../../character/commands/spells'
import type { CombatState } from '../types'
import { getHazardOf } from '../rules/hazard'
import { isSuffocating } from '../rules/situational'
import { getMoraleCalled } from '../rules/morale'
import { getHold, getUpkeepAims } from '../rules/fireAgain'
import { makeAction } from '../factories'
import { appendActions } from './log'

// combat.tex "End of the round": "reset to 8 AP minus any negative AP they
// had. Any unspent AP is lost." — a surge's among it.
function resetAP(c: CampaignCharacter): CampaignCharacter {
  return { ...c, resources: { ...c.resources, AP: Math.min(ROUND_AP, c.resources.AP + ROUND_AP), surgeAP: 0 } }
}

// Everything due at the round change lands on each character — the charges
// a held spell draws from its item, letting go of one that has none left,
// then the upkeep of what is still held on or was fired this round; the
// fire touched in a turn the round change ended burns, and then the counter
// burns with the fire they stand in added, as one instance (combat.tex
// "Burning", "Fire"); not being able to breathe costs its STA. A fired
// ability is then spent, the bleed runs on (combat.tex "Bleed": +1 IL per
// bleed intensity at the end of every round in combat), the surge used this
// round is cleared and the AP reset. Whoever still holds a spell makes the
// focus surge holding it takes (the table's ruling), or lets go of it when
// they cannot. A dead character has nothing left to pay or bleed
// out further.
function endRound(state: CombatState, c: CampaignCharacter, dice: Dice): CampaignCharacter {
  if (isDead(c)) return c
  const burnt = burnAtRoundStart(getHazardOf(state, c.id).fire)(burnScorch(applyTrigger('end_round')(payHeldSources(() => rollPercent(dice))(c))))
  const spent = expireUsedAbilities(burnt)
  const due = bleed(1)(isSuffocating(state, c) ? suffocate(spent) : spent)
  const reset = resetAP({ ...due, usedSurge: null })
  if (!isConcentrating(reset)) return reset
  return canSurge('focus')(reset) ? actionSurge('focus')(reset) : loseConcentration(reset)
}

// combat.tex "Environmental and ongoing effects": "applied at the beginning
// of the round", to whoever stands in them as the ground is now. combat.tex
// "Morale": the round begins by calling to a test whoever the fight, as the
// round change left it, puts under enough stress. The upkeep a holder paid
// for a spray gives them a free aim of it (the table's ruling): the ground
// moves, nobody is harmed, and the fight waits on it like on a morale test.
export function nextRound(dice: Dice, newId: () => string): (state: CombatState) => CombatState {
  return (state) => {
    const characters = Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, endRound(state, c, dice)]))
    const next = { ...state, characters, round: state.round + 1, inTurnCharacter: '', fleeing: false, forcedSurge: '', turnQueue: [], fleers: [], contenders: [], lastContest: null, agreedToEnd: [], morale: [] }
    const called = { ...next, morale: getMoraleCalled(next).map((id) => ({ id, roll: null })) }
    return appendActions(called, getUpkeepAims(called).map(({ actorId, key }) => makeAction('fireAgain', { id: newId(), actorId, key, ...getHold(called, called.characters[actorId], key), upkeep: true, step: 'react' })))
  }
}
