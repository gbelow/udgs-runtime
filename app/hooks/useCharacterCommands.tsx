import { useActiveCharacterUpdate } from "./useActiveCharacterSelector"
import {
  actionSurge as doActionSurge,
  addAffliction,
  putGauntlets as doPutGauntlets,
  putHelm as doPutHelm,
  resetAllSkills as doResetAllSkills,
  resetSkill as doResetSkill,
  restCharacter,
  updateIL as doUpdateIL,
  updateSTA as doUpdateSTA,
} from "../domain/character/commands"
import { AfflictionKey, Skills, SurgeKind } from "../domain/types"


export function useCharacterCommands() {

  const update = useActiveCharacterUpdate()

  const actionSurge = (kind: SurgeKind) => {
    update(doActionSurge(kind))
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
    actionSurge,
    putAffliction,
    rest,
    updateIL,
    updateSTA,
    toggleGauntlets,
    toggleHelm,
    resetSkill,
    resetAllSkills,
  }
}
