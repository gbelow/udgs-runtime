import type { Character } from '../../types'
import { getAttitudeXP, type AttitudeHappening } from '../rules/attitudes'
import { addTrainingXP } from './learning'

// creating.tex "Evolving Convictions": the XP the character's attitudes give
// or take for what happened, counted on each conviction. XP may go below zero.
export function meetAttitudes(happened: AttitudeHappening): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => getAttitudeXP(c, happened).reduce((acc, { slot, XP }) => addTrainingXP(slot, XP)(acc), c)
}
