import { RACE_BONUS_KEYS, type Character, type Race, type RaceDraft } from '../../types'
import { getBarePart, withRaceDraft } from '../rules/race'
import { withBody } from './body'

// creating.tex "Races": the race is picked first, its values copied onto the
// character as a preset — size, grid shape, toughness, senses, base
// movement, natural armor, body and stance — and its traits onto the race
// being made. A part of the new body keeps what the part with its id held;
// the rest is settled as any new body is. Only while the race is being made.
export function applyRace(race: Race): (c: Character) => Character {
  return (c: Character) => {
    if (!c.raceDraft) return c
    const { name, description, playable, bonuses, abilities, size, shape, TGH, senses, movement, armor, stance } = race
    const body = race.body.map((part) => ({ ...getBarePart(part), itemId: c.body.find((p) => p.id === part.id)?.itemId ?? '' }))
    const raced = { ...c, raceDraft: { name, description, playable, bonuses: { ...bonuses }, abilities: [...abilities] }, size, shape, TGH, senses, movement, armor, stance }
    return withBody(raced, body)
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

// creating.tex "Step 2: Race": "Add the attribute bonuses" — the race is
// settled for good. Its bonuses join the attributes and talents, its
// abilities join the ones the character has, and the race itself is
// forgotten: the character is what it made of them.
export function commitRace(c: Character): Character {
  const draft = c.raceDraft
  if (!draft) return c
  const trainables = { ...c.trainables }
  for (const key of RACE_BONUS_KEYS) {
    const bonus = draft.bonuses[key] ?? 0
    if (bonus) trainables[key] = { ...trainables[key], value: trainables[key].value + bonus }
  }
  const abilities = [...c.abilities, ...draft.abilities.filter((key) => !c.abilities.includes(key))]
  return { ...c, trainables, abilities, raceDraft: null }
}
