import type { CampaignCharacter } from './types'

// The roster and a fight hold instances, not characters: the same sheet can be
// added twice and the two copies take damage independently. `fightName`
// disambiguates them for display, and the id does the same for storage — a
// copy whose id is already in the record is issued a fresh one, so it cannot
// overwrite the entry that is keyed by it. The first copy keeps its id, which
// is what lets a player character in play still save back over its own
// record. The id source is injected to keep this deterministic.
export function addInstance(
  char: CampaignCharacter,
  characters: Record<string, CampaignCharacter>,
  newId: () => string,
): CampaignCharacter {
  const id = characters[char.id] ? newId() : char.id
  return { ...char, id, fightName: makeFightName(char, characters) }
}

// The record with the instance added.
export function withInstance(
  char: CampaignCharacter,
  characters: Record<string, CampaignCharacter>,
  newId: () => string,
): Record<string, CampaignCharacter> {
  const added = addInstance(char, characters, newId)
  return { ...characters, [added.id]: added }
}

function makeFightName(char: CampaignCharacter, characters: Record<string, CampaignCharacter>): string {
  let newName = char.name
  let count = 1
  while (Object.values(characters).some((el) => el.fightName === newName)) {
    count++
    newName = char.name + count
  }
  return newName
}
