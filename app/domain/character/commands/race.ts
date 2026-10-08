import { type Character, type Race, type RaceDraft } from '../../types'
import { getRacedCharacter, withRaceDraft } from '../rules/race'
import { withBody } from './body'

// creating.tex "Races", free creation: a saved race started from as a preset,
// its traits put on the character (getRacedCharacter). Nothing of the race is
// remembered afterwards; the new body is settled as any new body is.
export function applyRace(race: Race): (c: Character) => Character {
  return (c: Character) => {
    const raced = getRacedCharacter(race)(c)
    return withBody(raced, raced.body)
  }
}

// The race's own traits, changed while it is being made.
export function editRace(traits: Partial<RaceDraft>): (c: Character) => Character {
  return (c: Character) => withRaceDraft(c, traits)
}

// An ability the race has, added or taken away while it is being made.
export function addRaceAbility(key: string): (c: Character) => Character {
  return (c: Character) => (!c.raceDraft || c.raceDraft.abilities.includes(key) ? c : withRaceDraft(c, { abilities: [...c.raceDraft.abilities, key] }))
}

export function removeRaceAbility(key: string): (c: Character) => Character {
  return (c: Character) => (c.raceDraft?.abilities.includes(key) ? withRaceDraft(c, { abilities: c.raceDraft.abilities.filter((a) => a !== key) }) : c)
}
