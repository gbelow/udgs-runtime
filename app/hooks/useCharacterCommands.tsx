import { useActiveCharacterUpdate } from "./useActiveCharacterSelector"
import { AfflictionKey, Skills } from "../domain/types"
import type { LimitStressAction } from "../domain/lists"


export function useCharacterCommands() {

  const update = useActiveCharacterUpdate()

  const chooseLimitStress = (action: LimitStressAction | null) => {
    update({ kind: 'setLimitStress', args: [action] })
  }

  const endSurge = () => {
    update({ kind: 'endSurge', args: [] })
  }

  const putAffliction = (affliction: AfflictionKey) => {
    update({ kind: 'addAffliction', args: [affliction] })
  }

  const updateIL = (newIL: number) => {
    update({ kind: 'updateIL', args: [newIL] })
  }

  const updateSTA = (newSTA: number) => {
    update({ kind: 'updateSTA', args: [newSTA] })
  }

  const resetSkill = (skillName: keyof Skills) => {
    update({ kind: 'resetSkill', args: [skillName] })
  }

  const resetAllSkills = () => {
    update({ kind: 'resetAllSkills', args: [] })
  }

  return {
    endSurge,
    putAffliction,
    updateIL,
    updateSTA,
    chooseLimitStress,
    resetSkill,
    resetAllSkills,
  }
}
