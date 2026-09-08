import { useActiveCharacterUpdate } from "./useActiveCharacterSelector"
import {
  actionSurge as doActionSurge,
  addAffliction,
  putGauntlets as doPutGauntlets,
  putHelm as doPutHelm,
  resetAllSkills as doResetAllSkills,
  resetSkill as doResetSkill,
  restCharacter,
  updateIL as heal,
  updateSTA as bleed,
} from "../domain/character/commands"
import { AfflictionKey, Skills } from "../domain/types"


export function useCharacterCommands() {

  const update = useActiveCharacterUpdate()

  const actionSurge = () => {
    update(doActionSurge)
  }

  const putAffliction = (affliction: AfflictionKey) => {
    update(addAffliction(affliction))
  }

  const rest = () => {
    update(restCharacter)
  }

  const cureIL = (newIL: number) => {
    update(heal(newIL))
  }

  const updateSTA = (newSTA: number) => {
    update(bleed(newSTA))
  }

  const toggleGauntlets = () => {
    update(doPutGauntlets)
  }

  const toggleHelm = () => {
    update(doPutHelm)
  }

  const resetSkill = (skillName: keyof Skills) => {
    update(doResetSkill(skillName))
  }

  const resetAllSkills = () => {
    update(doResetAllSkills())
  }

  return {
    actionSurge: actionSurge,
    putAffliction,
    rest,
    cureIL,
    updateSTA,
    toggleGauntlets,
    toggleHelm,
    resetSkill,
    resetAllSkills,
  }
}
