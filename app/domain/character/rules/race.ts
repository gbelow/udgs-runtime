import { RaceSchema, type BodyPart, type Character, type Race, type RaceDraft } from '../../types'

// creating.tex "Character Creation", "Step 2: Race": whether the character is
// still at its race. Until the race is committed only what the race sets is
// made; afterwards it is the character's own and no longer changed.
export function isMakingRace(c: Character): boolean {
  return c.raceDraft !== null
}

// A part as a race describes it: whole and holding nothing.
export function getBarePart(part: BodyPart): BodyPart {
  return { ...part, itemId: '', lost: false }
}

// The race being made as it stands on the character, to be saved as a race
// of its own: its traits and what it sets, with the body bare. Null once the
// race is committed.
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

// The race's traits changed while it is being made.
export function withRaceDraft(c: Character, traits: Partial<RaceDraft>): Character {
  return c.raceDraft ? { ...c, raceDraft: { ...c.raceDraft, ...traits } } : c
}
