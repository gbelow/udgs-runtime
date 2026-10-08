import { RACE_BONUS_KEYS, type Character, type Race, type RaceDraft } from '../../types'
import { getBarePart, withRaceDraft } from '../rules/race'
import { withBody } from './body'

// creating.tex "Races", free creation: a saved race started from as a preset.
// What it sets of the creature — size, grid shape, toughness, senses, base
// movement, natural armor, body and stance — replaces the character's; its
// bonuses join the attributes and talents and its abilities join the ones the
// character has. Nothing of the race is remembered afterwards. A part of the
// new body keeps what the part with its id held; the rest is settled as any
// new body is.
export function applyRace(race: Race): (c: Character) => Character {
  return (c: Character) => {
    const { bonuses, size, shape, TGH, senses, movement, armor, stance } = race
    const body = race.body.map((part) => ({ ...getBarePart(part), itemId: c.body.find((p) => p.id === part.id)?.itemId ?? '' }))
    const trainables = { ...c.trainables }
    for (const key of RACE_BONUS_KEYS) {
      const bonus = bonuses[key] ?? 0
      if (bonus) trainables[key] = { ...trainables[key], value: trainables[key].value + bonus }
    }
    const abilities = [...c.abilities, ...race.abilities.filter((key) => !c.abilities.includes(key))]
    return withBody({ ...c, size, shape, TGH, senses, movement, armor, stance, trainables, abilities }, body)
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
