import type { Character, CharacterRace, Race } from '../../types'
import { isCampaignCharacter } from '../../utils'
import { getBarePart, isRaceCommitted } from '../rules/race'

// creating.tex "Races": the race is picked first, its values copied onto the
// character as a preset — size, grid shape, toughness, senses, base
// movement, natural armor, body and stance, with its bonuses and abilities.
// Nothing links back to the race afterwards. A grip survives onto a part of
// the new body with the same id that grips; what nothing holds any more is
// let go of, and a wound on a part the new body does not take is gone. A
// committed race is not picked again.
export function applyRace(race: Race): (c: Character) => Character {
  return (c: Character) => {
    if (isRaceCommitted(c)) return c
    const { name, description, playable, bonuses, abilities, size, shape, TGH, senses, movement, armor, stance } = race
    const body = race.body.map((part) => {
      const was = c.body.find((p) => p.id === part.id && p.grip && !p.lost)
      return { ...getBarePart(part), itemId: part.grip && was ? was.itemId : '' }
    })
    const gripped = new Set(body.map((part) => part.itemId))
    const raced = {
      ...c,
      race: { name, description, playable, bonuses: { ...bonuses }, abilities: [...abilities], committed: false },
      size, shape, TGH, senses, movement, armor, stance, body,
      held: c.held.filter((item) => gripped.has(item.id)),
    }
    if (!isCampaignCharacter(raced)) return raced
    const wounds = raced.injuries.wounds.filter((w) => body.some((p) => p.id === w.part && p.wounds.some((pw) => pw.name === w.name)))
    return { ...raced, injuries: { ...raced.injuries, wounds } }
  }
}

// The race's own traits, changed while it is still being made.
export function editRace(traits: Partial<Omit<CharacterRace, 'committed'>>): (c: Character) => Character {
  return (c: Character) => {
    if (!c.race || c.race.committed) return c
    return { ...c, race: { ...c.race, ...traits } }
  }
}

// The race is settled for good: what it set is locked and the character's
// own values are opened.
export function commitRace(c: Character): Character {
  if (!c.race || c.race.committed) return c
  return { ...c, race: { ...c.race, committed: true } }
}
