import type { SurgeKind } from "../domain/types"
import { removeFromFight, resetFight } from "../domain/scene/commands/fight"
import type { CalledKind } from "../domain/scene/rules/heldTest"
import type { RollMode } from "../domain/play/dice"
import { useCombatStore } from "../stores/useCombatStore"
import { useCampaignStore } from "../stores/useCampaignStore"
import { useAppStore } from "../stores/useAppStore"
import { isCampaignCharacter } from "../domain/utils"
import { readActiveCharacter } from "./useActiveCharacterSelector"
import { useSceneDispatch } from "./useSceneDispatch"

// The turn, the round and the fight's parties, each press sent as a scene
// command; whom it acts for is the registry's to say. Taking a character out
// of the fight, or emptying it, crosses into the campaign and is landed on
// both.
export function useCombatCommands() {

  const tab = useAppStore((s) => s.selectedGameTab)
  const updateTable = useCampaignStore((s) => s.updateTable)
  const dispatch = useSceneDispatch()

  // the turn buttons act for the character this screen has picked
  const asPicked = (send: (id: string) => void) => () => {
    const id = useCombatStore.getState().activeCharacterId
    if (id) send(id)
  }

  const killCharacter = () => {
    const c = readActiveCharacter(tab)
    if (c && isCampaignCharacter(c)) updateTable(removeFromFight(c.id))
  }

  const startTurn = asPicked((id) => dispatch({ kind: "startTurn", args: [id] }))
  const toggleContest = asPicked((id) => dispatch({ kind: "toggleContest", args: [id] }))
  const toggleAgreeToEnd = asPicked((id) => dispatch({ kind: "toggleAgreeToEnd", args: [id] }))
  const actionSurge = (kind: SurgeKind) => asPicked((id) => dispatch({ kind: "surge", args: [id, kind] }))()
  const defaultToCoward = asPicked((id) => dispatch({ kind: "defaultToCoward", args: [id] }))
  const endTurn = () => dispatch({ kind: "endTurn", args: [] })
  const rollContest = () => dispatch({ kind: "rollContest", args: [] })
  const nextRound = () => dispatch({ kind: "nextRound", args: [] })
  const endCombat = () => dispatch({ kind: "endCombat", args: [] })
  const continueRound = () => dispatch({ kind: "continueRound", args: [] })
  const holdOn = (id: string) => dispatch({ kind: "holdOn", args: [id] })
  const letGo = (id: string) => dispatch({ kind: "letGo", args: [id] })
  const rollMorale = (id: string, mode: RollMode, enemyNear: boolean, die?: number) => dispatch({ kind: "rollMorale", args: [id, mode, enemyNear, die] })
  const rollHeld = (id: string, kind: CalledKind, mode: RollMode, die?: number) => dispatch({ kind: "rollHeld", args: [id, kind, mode, die] })
  const setTablePressure = (id: string, value: number) => dispatch({ kind: "setTablePressure", args: [id, value] })
  const toggleBreakage = () => dispatch({ kind: "toggleBreakage", args: [] })

  const moveToParty = (id: string, partyId: string) => dispatch({ kind: "moveToParty", args: [id, partyId] })
  const createParty = (name: string) => dispatch({ kind: "createParty", args: [name] })
  const splitOff = (id: string) => dispatch({ kind: "splitOff", args: [id] })
  const renameParty = (partyId: string, name: string) => dispatch({ kind: "renameParty", args: [partyId, name] })
  const removeCharacter = (id: string) => updateTable(removeFromFight(id))
  const resetCombat = () => updateTable(resetFight)

  return { killCharacter, startTurn, toggleContest, toggleAgreeToEnd, rollContest, endTurn, actionSurge, nextRound, endCombat, continueRound, holdOn, letGo, rollMorale, setTablePressure, rollHeld, defaultToCoward, resetCombat, toggleBreakage, moveToParty, createParty, splitOff, renameParty, removeCharacter }
}
