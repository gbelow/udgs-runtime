import { nextRound as passRound } from "../domain/commands/nextRound"
import { startTurn as beginTurn } from "../domain/commands/startTurn"
import { resetCombat as resetGame} from "../domain/commands/resetCombat"
import { useCombatStore } from "../stores/useCombatStore"
import { useActiveCharacter } from "./useActiveCharacter"
import { isCampaignCharacter } from "../domain/utils"

export function useCombatCommands() {

  const { character } = useActiveCharacter()

  const { removeCharacter, updateCombatState } = useCombatStore()

  const killCharacter = () => {
    if(character && isCampaignCharacter(character)) removeCharacter(character?.id)
    
  }

  const startTurn = () => {
    updateCombatState(beginTurn)
  }

  const nextRound = () => {
    updateCombatState(passRound)
  }

  const resetCombat = () => {
    updateCombatState(resetGame)
  }



  return { killCharacter, startTurn, nextRound, resetCombat}
}