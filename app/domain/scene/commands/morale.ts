import type { MoraleRoll, Updater } from '../types'
import { rollModed, type Dice, type RollMode } from '../../play/dice'
import { cure, inflict } from '../../character/commands/addAffliction'
import { getCompulsionDegree, getCompulsionResistance, getHypeUpBar, getMoraleBar, getMoraleModes, getMoraleOutcome, getMoraleTest, getMoraleTurnBar, getPressure, getPressureKey, getSkipMoraleBar } from '../rules/morale'
import { resolveTest } from '../../play/test'
import { updateCharacter } from './characters'
import { oweStress } from './stress'
import { meetAttitudes, meetEachAttitude } from '../../character/commands/attitudes'
import { getThrowHappenings } from '../../character/rules/attitudes'
import { getSceneModeOf } from '../rules/test'

// combat.tex "Combat morale test": the character's will test against the DL
// of the moment, thrown in a way their abilities allow (`getMoraleModes`), or
// riskily while they keep to risky tests. What it
// leaves them is the outcome's (`getMoraleOutcome`); `enemyNear` is whether
// an enemy is within 30 m, told by the table. The last test of the round
// made, the limit stress actions it activated are owed (`oweStress`). The
// die, the test and an activated limit stress action move the character's
// convictions by their attitudes (abilities.tex "Fatalism", "Adaptation").
export function rollMorale(id: string, mode: RollMode, enemyNear: boolean, dice: Dice): Updater {
  return (state) => {
    const test = getMoraleTest(state, id)
    if (!test || getMoraleBar(state, id) || !getMoraleModes(state.characters[id]).includes(mode)) return state
    const thrown = getSceneModeOf(state)(id, mode)
    const { die, score, degree } = resolveTest(test, (explodes) => rollModed(thrown, explodes, dice))
    const resisted = getCompulsionResistance(state.characters[id])
    const outcome = getMoraleOutcome(state.characters[id], degree, getCompulsionDegree(state.characters[id], score, test.DL), enemyNear, getPressure(state, id).hostile?.kind === 'taunt')
    const settled = [
      updateCharacter(id, (c) => inflict(outcome.inflict)(cure(outcome.cure)(c)), 'morale test'),
      updateCharacter(id, meetEachAttitude(getThrowHappenings({ mode: thrown, die, explodes: test.explodes, scored: { skill: 'will', value: test.skill, DL: test.DL, degree } })), 'conviction attitude'),
      ...(outcome.limitStress ? [updateCharacter(id, meetAttitudes({ event: 'limitStress' }), 'conviction attitude')] : []),
    ].reduce((acc, step) => step(acc), state)
    const roll: MoraleRoll = { mode: thrown, die, skill: test.skill, score, DL: test.DL, degree, resisted, limitStress: outcome.limitStress, hyped: false }
    const tested = { ...settled, morale: settled.morale.map((call) => (call.id === id ? { ...call, roll } : call)) }
    return getMoraleTurnBar(tested) ? tested : oweStress(tested)
  }
}

// abilities.json "Hype Up": the character passes up the morale test they
// could have chosen to make. The last of the round's tests settled, the
// limit stress actions they activated are owed, as after a roll.
export function skipMorale(id: string): Updater {
  return (state) => {
    if (getSkipMoraleBar(state, id)) return state
    const skipped = { ...state, morale: state.morale.filter((call) => call.id !== id) }
    return getMoraleTurnBar(skipped) ? skipped : oweStress(skipped)
  }
}

// abilities.tex "Hype up": the character enrages themselves on the hit or
// crit their morale test came to, which ends their fear (combat.tex
// "Afraid").
export function hypeUp(id: string): Updater {
  return (state) => {
    if (getHypeUpBar(state, id)) return state
    const enraged = updateCharacter(id, (c) => inflict(['enraged'])(cure(['afraid'])(c)), 'hype up')(state)
    return { ...enraged, morale: enraged.morale.map((call) => (call.id === id && call.roll ? { ...call, roll: { ...call.roll, hyped: true } } : call)) }
  }
}

// combat.tex "Morale", "Pressure", "Simplifying": the table sets how the fight
// weighs on a party, held until it is set again; nothing for a party nobody
// in the fight is in.
export function setTablePressure(partyId: string, value: number): Updater {
  return (state) => {
    if (!Object.keys(state.characters).some((id) => getPressureKey(state, id) === partyId)) return state
    const { [partyId]: _old, ...rest } = state.tablePressure
    return { ...state, tablePressure: value === 0 ? rest : { ...rest, [partyId]: value } }
  }
}
