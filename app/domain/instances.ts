import type { CampaignCharacter } from './types'

// The roster and a fight hold instances, not characters: the same sheet can be
// added twice and the two copies take damage independently. `fightName`
// disambiguates them for display, and the id does the same for storage — a
// copy whose id is `taken` anywhere at the table is issued a fresh one, so it
// cannot overwrite the entry that is keyed by it. The first copy keeps its id,
// which is what lets a player character in play still save back over its own
// record. The id source is injected to keep this deterministic.
export function addInstance(
  char: CampaignCharacter,
  characters: Record<string, CampaignCharacter>,
  newId: () => string,
  taken: readonly string[],
): CampaignCharacter {
  const id = taken.includes(char.id) ? newId() : char.id
  return { ...char, id, fightName: makeFightName(char, characters) }
}

// The name the character goes by among these characters, which tells copies
// of one sheet apart.
export function makeFightName(char: CampaignCharacter, characters: Record<string, CampaignCharacter>): string {
  let newName = char.name
  let count = 1
  while (Object.values(characters).some((el) => el.fightName === newName)) {
    count++
    newName = char.name + count
  }
  return newName
}
