import { useAppStore } from "../stores/useAppStore"
import { useActiveCharacter } from "./useActiveCharacter"
import { saveCharacter } from "../actions"

export function useGameCommands() {

  const { character, update } = useActiveCharacter()
  const updatePlayerCharacterList = useAppStore(s => s.updatePlayerCharacterList)

  const savePlayerCharacter = () => {
    if(!character) return
    saveCharacter(character)
    updatePlayerCharacterList()
  }

  return { savePlayerCharacter }
}