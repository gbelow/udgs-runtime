import { RACE_BONUS_KEYS, RaceSchema, type BodyPart, type Character, type Race, type RaceDraft } from '../../types'
import { ABILITIES, ABILITY_FAMILY_OF, getAbilityLevel, heldAbility, isAbilityKey } from '../../abilities'

// A part as a race describes it: whole and holding nothing.
export function getBarePart(part: BodyPart): BodyPart {
  return { ...part, itemId: '', lost: false }
}

// A race being made is held as a character carrying the race's traits, so the
// creature's own editors work on it. This is the race it stands for, to be
// saved: its traits and what it sets, with the body bare. Null for a
// character that holds no race.
export function getRaceOf(c: Character): Race | null {
  if (!c.raceDraft) return null
  return RaceSchema.parse({
    ...c.raceDraft,
    size: c.size,
    footprint: c.footprint,
    TGH: c.TGH,
    senses: c.senses,
    movement: c.movement,
    armor: c.armor,
    body: c.body.map(getBarePart),
    stance: c.stance,
  })
}

// The race's traits changed, on a character holding a race.
export function withRaceDraft(c: Character, traits: Partial<RaceDraft>): Character {
  return c.raceDraft ? { ...c, raceDraft: { ...c.raceDraft, ...traits } } : c
}

// creating.tex "Races": the character with a race's traits on it. What it sets
// of the creature — size, footprint, toughness, senses, base movement,
// natural armor, body and stance — replaces the character's; its bonuses join
// the attributes and talents and its abilities join the ones the character
// has. A part of the new body keeps the item the part with its id held.
export function getRacedCharacter(race: Race): (c: Character) => Character {
  return (c: Character) => {
    const { bonuses, size, footprint, TGH, senses, movement, armor, stance } = race
    const body = race.body.map((part) => ({ ...getBarePart(part), itemId: c.body.find((p) => p.id === part.id)?.itemId ?? '' }))
    const trainables = { ...c.trainables }
    for (const key of RACE_BONUS_KEYS) {
      const bonus = bonuses[key] ?? 0
      if (bonus) trainables[key] = { ...trainables[key], value: trainables[key].value + bonus }
    }
    const abilities = { ...c.abilities }
    for (const key of race.abilities.filter(isAbilityKey)) {
      const family = ABILITY_FAMILY_OF[key]
      if (getAbilityLevel(c, family) < ABILITIES[key].stage) abilities[family] = heldAbility(family, ABILITIES[key].stage)
    }
    return { ...c, size, footprint, TGH, senses, movement, armor, stance, trainables, abilities, body }
  }
}
