import { useActiveCharacter } from "./useActiveCharacter"
import { actionSurge as doActionSurge} from "../domain/commands/actionSurge"
import { addAffliction } from "../domain/commands/addAffliction"
import { AfflictionKey } from "../domain/types"
import { restCharacter } from "../domain/commands/rest"


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

  return { actionSurge: actionSurge, putAffliction, rest }
} 