import { useActiveCharacterUpdate } from "./useActiveCharacterSelector"
import {
  endSurge as doEndSurge,
  addAffliction,
  resetAllSkills as doResetAllSkills,
  resetSkill as doResetSkill,
  updateIL as doUpdateIL,
  updateSTA as doUpdateSTA,
} from "../domain/character/commands"
import { AfflictionKey, Skills } from "../domain/types"


export function useCharacterCommands() {

  const update = useActiveCharacterUpdate()

  const endSurge = () => {
    update(doEndSurge)
  }

  const putAffliction = (affliction: AfflictionKey) => {
    update(addAffliction(affliction))
  }

  const updateIL = (newIL: number) => {
    update(doUpdateIL(newIL))
  }

  const updateSTA = (newSTA: number) => {
    update(doUpdateSTA(newSTA))
  }

  const resetSkill = (skillName: keyof Skills) => {
    update(doResetSkill(skillName))
  }

  const resetAllSkills = () => {
    update(doResetAllSkills())
  }

  return {
    endSurge,
    putAffliction,
    updateIL,
    updateSTA,
    resetSkill,
    resetAllSkills,
  }
}
