import { Character, CharacterUpdater, Container, ContainerKind } from '../../types'

// gear.tex "Containers": "only one backpack, one bandolier and one belt at a
// time". Equipping one of these replaces whichever other entry is currently
// of that same kind, contents included. Saddles and vehicles aren't limited.
const WORN_ONE_AT_A_TIME: ReadonlySet<ContainerKind> = new Set(['belt', 'bandolier', 'backpack'])

export function equipContainer(key: string, container: Container): CharacterUpdater {
  return (character: Character) => {
    const singleton = WORN_ONE_AT_A_TIME.has(container.kind)
    const remaining = Object.fromEntries(
      Object.entries(character.containers).filter(([otherKey, other]) => {
        if (otherKey === key) return false
        if (singleton && other.kind === container.kind) return false
        return true
      })
    )
    return {
      ...character,
      containers: { ...remaining, [key]: container },
    }
  }
}

export function unequipContainer(key: string): CharacterUpdater {
  return (character: Character) => {
    if (!character.containers[key]) return character
    const { [key]: _removed, ...remaining } = character.containers
    return { ...character, containers: remaining }
  }
}
