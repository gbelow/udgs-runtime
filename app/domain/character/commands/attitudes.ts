import type { Character } from '../../types'
import type { FamilyKey } from '../../abilities'
import type { ConvictionSlot } from '../rules/requirements'
import { getAttitudeXP, getStudies, type AttitudeHappening } from '../rules/attitudes'
import { addAbilityXP, addTrainingXP } from './learning'

// creating.tex "Evolving Convictions": the XP the character's attitudes give
// or take for what happened, counted on each conviction. XP may go below zero.
export function meetAttitudes(happened: AttitudeHappening): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => getAttitudeXP(c, happened).reduce((acc, { slot, XP }) => addTrainingXP(slot, XP)(acc), c)
}

// abilities.json "Cunning Studies": the conviction's XP trains an ability it
// may study, and counts for the conviction as well. Nothing where it may not.
export function studyWithConviction(slot: ConvictionSlot, family: FamilyKey, amount: number): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => {
    if (!getStudies(c, slot).includes(family)) return c
    return addAbilityXP(family, amount)(addTrainingXP(slot, amount)(c)) as C
  }
}
