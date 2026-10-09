import type { MoraleRoll, Updater } from '../types'
import { rollModed, type Dice, type RollMode } from '../../play/dice'
import { cure, inflict } from '../../character/commands/addAffliction'
import { getMoraleBar, getMoraleOutcome, getMoraleTest, getMoraleTurnBar, getPressure } from '../rules/morale'
import { resolveTest } from '../../play/test'
import { updateCharacter } from './characters'
import { oweStress } from './stress'

// combat.tex "Combat morale test": the character's will test against the DL
// of the moment, normally, safely or riskily as the player decides. What it
// leaves them is the outcome's (`getMoraleOutcome`); `enemyNear` is whether
// an enemy is within 30 m, told by the table. The last test of the round
// made, the limit stress actions it activated are owed (`oweStress`).
export function rollMorale(id: string, mode: RollMode, enemyNear: boolean, dice: Dice): Updater {
  return (state) => {
    const test = getMoraleTest(state, id)
    if (!test || getMoraleBar(state, id)) return state
    const { die, score, degree } = resolveTest(test, (explodes) => rollModed(mode, explodes, dice))
    const outcome = getMoraleOutcome(degree, enemyNear, getPressure(state, id).hostile?.kind === 'taunt')
    const settled = updateCharacter(id, (c) => inflict(outcome.inflict)(cure(outcome.cure)(c)), 'morale test')(state)
    const roll: MoraleRoll = { mode, die, skill: test.skill, score, DL: test.DL, degree, limitStress: outcome.limitStress }
    const tested = { ...settled, morale: settled.morale.map((call) => (call.id === id ? { ...call, roll } : call)) }
    return getMoraleTurnBar(tested) ? tested : oweStress(tested)
  }
}

// combat.tex "Morale", "Pressure": the table sets how the fight weighs on the
// character, held until it is set again; nothing for a character not in the
// fight.
export function setTablePressure(id: string, value: number): Updater {
  return (state) => {
    if (!state.characters[id]) return state
    const { [id]: _old, ...rest } = state.tablePressure
    return { ...state, tablePressure: value === 0 ? rest : { ...rest, [id]: value } }
  }
}
