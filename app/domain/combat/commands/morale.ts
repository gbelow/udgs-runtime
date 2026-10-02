import type { MoraleRoll, Updater } from '../types'
import { rollModed, type Dice, type RollMode } from '../dice'
import { cure, inflict } from '../../character/commands/addAffliction'
import { getMoraleBar, getMoraleOutcome, getMoraleTest } from '../rules/morale'
import { resolveTest } from '../rules/test'
import { updateCharacter } from './characters'

// combat.tex "Combat morale test": the character's will test against the DL
// of the moment, normally, safely or riskily as the player decides. What it
// leaves them is the outcome's (`getMoraleOutcome`); `enemyNear` is whether
// an enemy is within 30 m, told by the table.
export function rollMorale(id: string, mode: RollMode, enemyNear: boolean, dice: Dice): Updater {
  return (state) => {
    const test = getMoraleTest(state, id)
    if (!test || getMoraleBar(state, id)) return state
    const { die, score, degree } = resolveTest(test, (explodes) => rollModed(mode, explodes, dice))
    const outcome = getMoraleOutcome(degree, enemyNear)
    const settled = updateCharacter(id, (c) => inflict(outcome.inflict)(cure(outcome.cure)(c)))(state)
    const roll: MoraleRoll = { mode, die, skill: test.skill, score, DL: test.DL, degree, limitStress: outcome.limitStress }
    return { ...settled, morale: settled.morale.map((call) => (call.id === id ? { ...call, roll } : call)) }
  }
}
