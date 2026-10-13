import { continueRound as moveRoundOn, holdOn as holdOnTo, letGo as letGoOf, nextRound as passRound } from "../domain/scene/commands/nextRound"
import { endTurn as closeTurn, rollContest as rollTurnContest, startTurn as beginTurn, surge, toggleAgreeToEnd as toggleAgreement, toggleContest as toggleTurnContest } from "../domain/scene/commands/turn"
import type { SurgeKind } from "../domain/types"
import { removeFromFight, resetFight } from "../domain/scene/commands/fight"
import { endCombat as finishCombat } from "../domain/scene/commands/endCombat"
import { moveToParty as moveInto, renameParty as renameFightParty, splitOff as splitFrom } from "../domain/scene/commands/parties"
import { toggleBreakage as switchBreakage } from "../domain/scene/commands/breakage"
import { rollMorale as testMorale, setTablePressure as setTablePressureOf } from "../domain/scene/commands/morale"
import { rollHeld as testHeld } from "../domain/scene/commands/heldTest"
import type { CalledKind } from "../domain/scene/rules/heldTest"
import { defaultToCoward as defaultToCowardSocial } from "../domain/scene/commands/social"
import type { Updater } from "../domain/scene/types"
import type { RollMode } from "../domain/play/dice"
import { useCombatStore } from "../stores/useCombatStore"
import { useCampaignStore } from "../stores/useCampaignStore"
import { useAppStore } from "../stores/useAppStore"
import { isCampaignCharacter } from "../domain/utils"
import { readActiveCharacter } from "./useActiveCharacterSelector"
import { realDice } from "../components/utils"

export function useCombatCommands() {

  const tab = useAppStore((s) => s.selectedGameTab)
  // Select just the stable action refs, not the whole combat store, to avoid
  // subscribing to every combat change.
  const updateCombatState = useCombatStore((s) => s.updateCombatState)
  const updateTable = useCampaignStore((s) => s.updateTable)
  const newId = () => crypto.randomUUID()

  const killCharacter = () => {
    const c = readActiveCharacter(tab)
    if (c && isCampaignCharacter(c)) updateTable(removeFromFight(c.id))
  }

  const renameParty = (partyId: string, name: string) => {
    updateCombatState(renameFightParty(partyId, name))
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

  const endCombat = () => {
    updateCombatState(finishCombat(realDice))
  }

  const continueRound = () => {
    updateCombatState(moveRoundOn(realDice))
  }

  const holdOn = (id: string) => {
    updateCombatState(holdOnTo(id, realDice))
  }

  const letGo = (id: string) => {
    updateCombatState(letGoOf(id, realDice))
  }

  const rollMorale = (id: string, mode: RollMode, enemyNear: boolean) => {
    updateCombatState(testMorale(id, mode, enemyNear, realDice))
  }

  const setTablePressure = (id: string, value: number) => {
    updateCombatState(setTablePressureOf(id, value))
  }

  const rollHeld = (id: string, kind: CalledKind, mode: RollMode) => {
    updateCombatState(testHeld(id, kind, mode, realDice))
  }

  const asActive = (command: (id: string) => Updater) => () => {
    const id = useCombatStore.getState().activeCharacterId
    if (id) updateCombatState(command(id))
  }

  const moveToParty = (partyId: string) => asActive((id) => moveInto(id, partyId))()
  const splitOff = asActive((id) => splitFrom(id, newId))

  const defaultToCoward = asActive(defaultToCowardSocial)

  const resetCombat = () => {
    updateTable(resetFight)
  }

  const toggleBreakage = () => {
    updateCombatState(switchBreakage)
  }

  return { killCharacter, startTurn, toggleContest, toggleAgreeToEnd, rollContest, endTurn, actionSurge, nextRound, endCombat, continueRound, holdOn, letGo, rollMorale, setTablePressure, rollHeld, defaultToCoward, resetCombat, toggleBreakage, moveToParty, splitOff, renameParty }
}
