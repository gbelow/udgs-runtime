import { useActiveCharacter } from "./useActiveCharacter"
import { actionSurge as doActionSurge} from "../domain/commands/actionSurge"
import { addAffliction } from "../domain/commands/addAffliction"
import { AfflictionKey } from "../domain/types"
import { restCharacter } from "../domain/commands/rest"
import { updateIL as heal } from "../domain/commands/heal"
import { updateSTA as bleed } from "../domain/commands/bleed"


export function useCharacterCommands() {

  const { update } = useActiveCharacter()

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

  return { actionSurge: actionSurge, putAffliction, rest, cureIL, updateSTA }
} 