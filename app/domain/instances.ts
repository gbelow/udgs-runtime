import type { CampaignCharacter } from './types'

// The roster and a fight hold instances, not characters: the same sheet can be
// added twice and the two copies take damage independently. The id tells them
// apart for storage — a copy whose id is `taken` anywhere at the table is
// issued a fresh one, so it cannot overwrite the entry that is keyed by it.
// The first copy keeps its id, which is what lets a player character in play
// still save back over its own record. The id source is injected to keep this
// deterministic. The name they go by is kept by whoever holds them, the
// campaign or the fight, not by the character.
export function addInstance(
  char: CampaignCharacter,
  newId: () => string,
  taken: readonly string[],
): CampaignCharacter {
  return taken.includes(char.id) ? { ...char, id: newId() } : char
}

// `name`, or the first "<name>n" none of the `taken` names is, which tells
// copies of one sheet apart.
export function makeName(name: string, taken: readonly string[]): string {
  let newName = name
  let count = 1
  while (taken.includes(newName)) {
    count++
    newName = name + count
  }
  return newName
}
