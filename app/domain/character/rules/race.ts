import { RaceSchema, type BodyPart, type Character, type Race, type RaceDraft } from '../../types'

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
    shape: c.shape,
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
