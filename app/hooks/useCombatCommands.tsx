import { nextRound as passRound } from "../domain/combat/commands/nextRound"
import { startTurn as beginTurn } from "../domain/combat/commands/startTurn"
import { resetCombat as resetGame} from "../domain/combat/commands/resetCombat"
import { useCombatStore } from "../stores/useCombatStore"
import { useAppStore } from "../stores/useAppStore"
import { isCampaignCharacter } from "../domain/utils"
import { readActiveCharacter } from "./useActiveCharacterSelector"

export function useCombatCommands() {

  const tab = useAppStore((s) => s.selectedGameTab)
  // Select just the stable action refs, not the whole combat store, to avoid
  // subscribing to every combat change.
  const removeCharacter = useCombatStore((s) => s.removeCharacter)
  const updateCombatState = useCombatStore((s) => s.updateCombatState)

  const killCharacter = () => {
    const c = readActiveCharacter(tab)
    if (c && isCampaignCharacter(c)) removeCharacter(c.id)
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
