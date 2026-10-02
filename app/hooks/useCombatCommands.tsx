import { nextRound as passRound } from "../domain/combat/commands/nextRound"
import { endTurn as closeTurn, rollContest as rollTurnContest, startTurn as beginTurn, surge, toggleAgreeToEnd as toggleAgreement, toggleContest as toggleTurnContest } from "../domain/combat/commands/turn"
import type { SurgeKind } from "../domain/types"
import { resetCombat as resetGame} from "../domain/combat/commands/resetCombat"
import { toggleBreakage as switchBreakage } from "../domain/combat/commands/breakage"
import { useCombatStore } from "../stores/useCombatStore"
import { useAppStore } from "../stores/useAppStore"
import { isCampaignCharacter } from "../domain/utils"
import { readActiveCharacter } from "./useActiveCharacterSelector"
import { realDice } from "../components/utils"

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

  // The turn buttons act for the active character; the commands refuse
  // whatever the turn controls show as closed.
  const startTurn = () => {
    const id = useCombatStore.getState().activeCharacterId
    if (id) updateCombatState(beginTurn(id))
  }

  const toggleContest = () => {
    const id = useCombatStore.getState().activeCharacterId
    if (id) updateCombatState(toggleTurnContest(id))
  }

  const toggleAgreeToEnd = () => {
    const id = useCombatStore.getState().activeCharacterId
    if (id) updateCombatState(toggleAgreement(id))
  }

  const rollContest = () => {
    updateCombatState(rollTurnContest(realDice))
  }

  const actionSurge = (kind: SurgeKind) => {
    const id = useCombatStore.getState().activeCharacterId
    if (id) updateCombatState(surge(id, kind))
  }

  const endTurn = () => {
    updateCombatState(closeTurn)
  }

  const nextRound = () => {
    updateCombatState(passRound(realDice))
  }

  const resetCombat = () => {
    updateCombatState(resetGame)
  }

  const toggleBreakage = () => {
    updateCombatState(switchBreakage)
  }

  return { killCharacter, startTurn, toggleContest, toggleAgreeToEnd, rollContest, endTurn, actionSurge, nextRound, resetCombat, toggleBreakage }
}
