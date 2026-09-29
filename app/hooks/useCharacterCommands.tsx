import { useActiveCharacterUpdate } from "./useActiveCharacterSelector"
import {
  endSurge as doEndSurge,
  addAffliction,
  resetAllSkills as doResetAllSkills,
  resetSkill as doResetSkill,
  restCharacter,
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

  const rest = () => {
    update(restCharacter)
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
    rest,
    updateIL,
    updateSTA,
    resetSkill,
    resetAllSkills,
  }
}
