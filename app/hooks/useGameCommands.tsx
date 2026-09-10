import { toast } from "sonner"
import { useAppStore } from "../stores/useAppStore"
import { readActiveCharacter } from "./useActiveCharacterSelector"
import { deleteBaseCharacter, saveCharacter, upsertBaseCharacter } from "../actions"

export function useGameCommands() {

  const tab = useAppStore((s) => s.selectedGameTab)
  const updatePlayerCharacterList = useAppStore(s => s.updatePlayerCharacterList)
  const updateBaseCharacterList = useAppStore(s => s.updateBaseCharacterList)

  const savePlayerCharacter = async () => {
    const character = readActiveCharacter(tab)
    if (!character) return
    const res = await saveCharacter(character)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Character saved.')
    updatePlayerCharacterList()
  }

  const saveBaseCharacter = async () => {
    const character = readActiveCharacter(tab)
    if (!character) return
    const res = await upsertBaseCharacter(character)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Base character saved.')
    updateBaseCharacterList()
  }

  const removeBaseCharacter = async () => {
    const character = readActiveCharacter(tab)
    if (!character) return
    const res = await deleteBaseCharacter(character.name)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Base character deleted.')
    updateBaseCharacterList()
  }

  return { savePlayerCharacter, saveBaseCharacter, removeBaseCharacter }
}
