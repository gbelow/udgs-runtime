import { toast } from "sonner"
import { useAppStore } from "../stores/useAppStore"
import { readActiveCharacter } from "./useActiveCharacterSelector"
import { deleteBaseCharacter, saveCharacter, upsertBaseCharacter } from "../actions"
import { copyAsBase } from "../domain/factories"

export function useGameCommands() {

  const tab = useAppStore((s) => s.selectedGameTab)
  const devServer = useAppStore((s) => s.devServer)
  const updatePlayerCharacterList =useAppStore(s => s.updatePlayerCharacterList)
  const updateBaseCharacterList = useAppStore(s => s.updateBaseCharacterList)

  const savePlayerCharacter = async () => {
    const character = readActiveCharacter(tab)
    if (!character) return
    const res = await saveCharacter(character)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Character saved.')
    updatePlayerCharacterList()
  }

  const copyToMyCharacters = async () => {
    const character = readActiveCharacter(tab)
    if (!character) return
    const res = await saveCharacter(copyAsBase(character, crypto.randomUUID()))
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Copied to your characters.')
    updatePlayerCharacterList()
  }

  const saveCatalogCharacter = async () => {
    const character = readActiveCharacter(tab)
    if (!character) return
    const res = await upsertBaseCharacter(character)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Catalog character saved.')
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

  return { savePlayerCharacter, copyToMyCharacters, saveCatalogCharacter, removeBaseCharacter, devServer }
}
