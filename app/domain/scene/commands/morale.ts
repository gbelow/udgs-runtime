import type { MoraleRoll, SceneState, Updater } from '../types'
import { rollModed, type Dice, type RollMode } from '../../play/dice'
import { cure, inflict } from '../../character/commands/addAffliction'
import { getCompulsionDegree, getCompulsionResistance, getFatefulAP, getFatefulBar, getHypeUpBar, getKeepMoraleBar, getMoraleBar, getMoraleModes, getMoraleOutcome, getMoraleTest, getMoraleTurnBar, getPressure, getPressureKey, getSkipMoraleBar, getStressAuthors, isLeftOpen } from '../rules/morale'
import { resolveTest, type Test } from '../../play/test'
import { payCost } from '../../character/commands/cost'
import { updateCharacter } from './characters'
import { oweStress } from './stress'
import { meetAttitudes, meetEachAttitude } from '../../character/commands/attitudes'
import { getThrowHappenings } from '../../character/rules/attitudes'
import { getSceneModeOf } from '../rules/test'
import { getMercifulTo } from '../rules/providence'
import { compelSurrender } from './providence'
import { inspire } from './inspiringDeed'

// combat.tex "Combat morale test": the character's will test against the DL
// of the moment, thrown in a way their abilities allow (`getMoraleModes`), or
// riskily while they keep to risky tests; `enemyNear` is whether an enemy is
// within 30 m, told by the table. A test left open for a reroll
// (abilities.tex "Fateful", `isLeftOpen`) is shown and settles later;
// any other settles at once (`settleMorale`).
export function rollMorale(id: string, mode: RollMode, enemyNear: boolean, dice: Dice): Updater {
  return (state) => {
    const test = getMoraleTest(state, id)
    if (!test || getMoraleBar(state, id) || !getMoraleModes(state.characters[id]).includes(mode)) return state
    const thrown = getSceneModeOf(state)(id, mode)
    const { die, score, degree, skillTerms } = resolveTest(test, (explodes) => rollModed(thrown, explodes, dice))
    const roll: MoraleRoll = { mode: thrown, die, skill: test.skill, skillTerms, score, DL: test.DL, degree, resisted: getCompulsionResistance(state.characters[id]), limitStress: false, hyped: false, open: false, rerolled: false, enemyNear }
    if (isLeftOpen(state.characters[id], degree)) return withRoll(state, id, { ...roll, open: true })
    return settleMorale(id, roll)(state)
  }
}

// abilities.tex "Fateful": the open test thrown again, the same test the same
// way, for the AP Fateful costs; the reroll stands, whatever it comes to.
export function rerollMorale(id: string, dice: Dice): Updater {
  return (state) => {
    const roll = state.morale.find((m) => m.id === id)?.roll
    const AP = getFatefulAP(state.characters[id])
    if (!roll || AP === null || getFatefulBar(state, id)) return state
    const test: Test = { skill: roll.skill, DL: roll.DL, explodes: false, scale: 'degrees' }
    const { die, score, degree } = resolveTest(test, (explodes) => rollModed(roll.mode, explodes, dice))
    const paid = updateCharacter(id, payCost({ AP, STA: 0 }, true), 'Fateful')(state)
    return settleMorale(id, { ...roll, die, score, degree, open: false, rerolled: true })(paid)
  }
}

// abilities.tex "Fateful": the open test kept as it came.
export function keepMorale(id: string): Updater {
  return (state) => {
    const roll = state.morale.find((m) => m.id === id)?.roll
    return roll && !getKeepMoraleBar(state, id) ? settleMorale(id, { ...roll, open: false })(state) : state
  }
}

const withRoll = (state: SceneState, id: string, roll: MoraleRoll): SceneState =>
  ({ ...state, morale: state.morale.map((call) => (call.id === id ? { ...call, roll } : call)) })

// What the test leaves the character is the outcome's (`getMoraleOutcome`).
// The die, the test and an activated limit stress action move the
// character's convictions by their attitudes (abilities.tex "Fatalism",
// "Adaptation"), and an activated one the convictions of the enemies whose
// social action weighed on the test ("Domination"). The last test of the round settled, the limit stress
// actions it activated are owed (`oweStress`).
function settleMorale(id: string, roll: MoraleRoll): Updater {
  return (state) => {
    const c = state.characters[id]
    const outcome = getMoraleOutcome(c, roll.degree, getCompulsionDegree(c, roll.score, roll.DL), roll.enemyNear, getPressure(state, id).hostile?.kind === 'taunt')
    const happened = getThrowHappenings({ mode: roll.mode, die: roll.die, explodes: false, scored: { skill: 'will', value: roll.skill, DL: roll.DL, degree: roll.degree } })
    // abilities.tex "Mercy": the limit stress action an intimidation of a Mercy
    // holder activated is a surrender in its place
    const merciful = outcome.limitStress && getMercifulTo(state, id).length > 0
    const settled = [
      updateCharacter(id, (c) => inflict(outcome.inflict)(cure(outcome.cure)(c)), 'morale test'),
      updateCharacter(id, meetEachAttitude(happened), 'conviction attitude'),
      ...(outcome.limitStress ? [updateCharacter(id, meetAttitudes({ event: 'limitStress' }), 'conviction attitude')] : []),
      ...(outcome.limitStress ? getStressAuthors(state, id).map((by) => updateCharacter(by, meetAttitudes({ event: 'enemyStress' }), 'conviction attitude')) : []),
      (acc: SceneState) => inspire(acc, id, happened),
      (acc: SceneState) => (merciful ? compelSurrender(acc, id) : acc),
      // abilities.tex "Oathbound": a hit or a crit in the morale test steels the
      // character for the round that begins
      updateCharacter(id, (c) => (roll.degree === 'hit' || roll.degree === 'critical' ? { ...c, steeled: true } : c), 'morale test'),
    ].reduce((acc, step) => step(acc), state)
    const tested = withRoll(settled, id, { ...roll, limitStress: outcome.limitStress && !merciful })
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
