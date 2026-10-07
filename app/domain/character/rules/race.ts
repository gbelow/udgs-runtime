import { RaceSchema, type BodyPart, type Character, type Race, type RaceBonusKey } from '../../types'

// creating.tex "Races": the race's bonus to an attribute or a talent, added
// over what the character bought ("Add the attribute bonuses after step 4").
export function getRaceBonus(c: Character, key: RaceBonusKey): number {
  return c.race?.bonuses[key] ?? 0
}

// The abilities the character has: the race's ("Has the Fur ability"), then
// the ones learned. The race's cost nothing and are not the character's to
// forget.
export function getAbilities(c: Character): string[] {
  const racial = c.race?.abilities ?? []
  return [...racial, ...c.abilities.filter((key) => !racial.includes(key))]
}

export function isRacialAbility(c: Character, key: string): boolean {
  return c.race?.abilities.includes(key) ?? false
}

// Once the race is committed, what it set — size, body, senses, movement,
// natural armor, its bonuses and abilities — is no longer the character's to
// change.
export function isRaceCommitted(c: Character): boolean {
  return c.race?.committed ?? false
}

// A part as a race describes it: whole and holding nothing.
export function getBarePart(part: BodyPart): BodyPart {
  return { ...part, itemId: '', lost: false }
}

// The race a character was made from as it stands on them now, to be saved
// as a race of its own: what the race set, with the body bare. Null for one
// made without a race.
export function getRaceOf(c: Character): Race | null {
  if (!c.race) return null
  const { committed, ...traits } = c.race
  void committed
  return RaceSchema.parse({
    ...traits,
    size: c.size,
    shape: c.shape,
    TGH: c.TGH,
    senses: c.senses,
    movement: c.movement,
    armor: c.armor,
    body: c.body.map(getBarePart),
    stance: c.stance,
  })
}
