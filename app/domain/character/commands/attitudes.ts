import type { Character } from '../../types'
import type { ConvictionSlot } from '../rules/requirements'
import { getAttitudeXP, getStudyOffer, type AttitudeHappening, type StudyTarget } from '../rules/attitudes'
import { addAbilityXP, addTrainingXP } from './learning'
import { isCampaignCharacter } from '../../utils'

// creating.tex "Evolving Convictions": the XP the character's attitudes give
// or take for what happened, counted on each conviction. XP may go below zero.
export function meetAttitudes(happened: AttitudeHappening): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => getAttitudeXP(c, happened).reduce((acc, { slot, XP }) => addTrainingXP(slot, XP)(acc), c)
}

// Each of what happened, met in turn.
export function meetEachAttitude(happened: readonly AttitudeHappening[]): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => happened.reduce((acc, h) => meetAttitudes(h)(acc), c)
}

// The conviction's XP trains something it may study, as far as the study
// takes it, and counts for the conviction as well (abilities.json "Cunning
// Studies", abilities.tex "Adaptive Learning"). Nothing where it may not.
export function studyWithConviction(slot: ConvictionSlot, target: StudyTarget, amount: number): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => {
    const offer = getStudyOffer(c, slot, target)
    if (!offer) return c
    const studied = addTrainingXP(slot, amount)(c)
    const trained = amount * offer.rate
    return (target.kind === 'trainable' ? addTrainingXP(target.key, trained)(studied) : addAbilityXP(target.family, trained)(studied)) as C
  }
}

// play.tex "Safe and risky tests": the character keeps to risky tests
// wherever they may throw one so, or goes back to normal ones.
export function setRisky(risky: boolean): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => (isCampaignCharacter(c) && c.risky !== risky ? { ...c, risky } : c)
}
