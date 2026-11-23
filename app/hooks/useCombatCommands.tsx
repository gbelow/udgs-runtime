import type { SurgeKind } from "../domain/types"
import type { CalledKind } from "../domain/scene/rules/heldTest"
import type { RollMode } from "../domain/play/dice"
import type { Order } from "../domain/scene/rules/domination"
import { useCombatStore } from "../stores/useCombatStore"
import { useAppStore } from "../stores/useAppStore"
import { isCampaignCharacter } from "../domain/utils"
import { readActiveCharacter } from "./useActiveCharacterSelector"
import { useSceneDispatch, useTableDispatch } from "./useSceneDispatch"
import { useViewerCheck } from "./useControl"
import { getControlledIds } from "../domain/profiles"

// The turn, the round and the fight's parties, each press sent as a scene
// command; whom it acts for is the registry's to say. Taking a character out
// of the fight, or emptying it, crosses into the campaign and is landed on
// both.
export function useCombatCommands() {

  const tab = useAppStore((s) => s.selectedGameTab)
  const sendTable = useTableDispatch()
  const dispatch = useSceneDispatch()
  const viewer = useViewerCheck()

  // the turn buttons act for the character this screen has picked
  const asPicked = (send: (id: string) => void) => () => {
    const id = useCombatStore.getState().activeCharacterId
    if (id) send(id)
  }

  const killCharacter = () => {
    const c = readActiveCharacter(tab)
    if (c && isCampaignCharacter(c)) sendTable({ kind: "removeFromFight", args: [c.id] })
  }

  const startTurn = asPicked((id) => dispatch({ kind: "startTurn", args: [id] }))
  const toggleContest = asPicked((id) => dispatch({ kind: "toggleContest", args: [id] }))
  const contestMode = (mode: RollMode) => asPicked((id) => dispatch({ kind: "contestMode", args: [id, mode] }))()
  const toggleAgreeToEnd = asPicked((id) => dispatch({ kind: "toggleAgreeToEnd", args: [id] }))
  const agreeAllToEnd = () => {
    const ids = getControlledIds(Object.keys(useCombatStore.getState().characters), viewer())
    if (ids.length > 0) dispatch({ kind: "agreeAllToEnd", args: [ids] })
  }
  const actionSurge = (kind: SurgeKind) => asPicked((id) => dispatch({ kind: "surge", args: [id, kind] }))()
  const follow = (targetId: string | null) => asPicked((id) => dispatch({ kind: "follow", args: [id, targetId] }))()
  const defaultToCoward =asPicked((id) => dispatch({ kind: "defaultToCoward", args: [id] }))
  const mock = asPicked((id) => dispatch({ kind: "mock", args: [id] }))
  const leadershipRally = asPicked((id) => dispatch({ kind: "leadershipRally", args: [id] }))
  const breakFree = asPicked((id) => dispatch({ kind: "breakFree", args: [id] }))
  const giveOrder = (by: string, targetId: string, order: Order) => dispatch({ kind: "giveOrder", args: [by, targetId, order] })
  const endTurn = () => dispatch({ kind: "endTurn", args: [] })
  const rollContest = () => dispatch({ kind: "rollContest", args: [] })
  const nextRound = () => dispatch({ kind: "nextRound", args: [] })
  const endCombat = () => dispatch({ kind: "endCombat", args: [] })
  const continueRound = () => dispatch({ kind: "continueRound", args: [] })
  // everyone this screen plays is done resting
  const doneResting = () => {
    const ids = getControlledIds(Object.keys(useCombatStore.getState().characters), viewer())
    if (ids.length > 0) dispatch({ kind: "doneResting", args: [ids] })
  }
  const holdOn = (id: string) => dispatch({ kind: "holdOn", args: [id] })
  const letGo = (id: string) => dispatch({ kind: "letGo", args: [id] })
  const rollMorale = (id: string, mode: RollMode, enemyNear: boolean, die?: number) => dispatch({ kind: "rollMorale", args: [id, mode, enemyNear, die] })
  const hypeUp = (id: string) => dispatch({ kind: "hypeUp", args: [id] })
  const skipMorale = (id: string) => dispatch({ kind: "skipMorale", args: [id] })
  const rerollMorale = (id: string, die?: number) => dispatch({ kind: "rerollMorale", args: [id, die] })
  const keepMorale = (id: string) => dispatch({ kind: "keepMorale", args: [id] })
  const rollHeld = (id: string, kind: CalledKind, mode: RollMode, die?: number) => dispatch({ kind: "rollHeld", args: [id, kind, mode, die] })
  const setTablePressure = (id: string, value: number) => dispatch({ kind: "setTablePressure", args: [id, value] })
  const toggleBreakage = () => sendTable({ kind: "toggleBreakage", args: [] })

  const moveToParty = (id: string, partyId: string) => dispatch({ kind: "moveToParty", args: [id, partyId] })
  const createParty = (name: string) => dispatch({ kind: "createParty", args: [name] })
  const splitOff = (id: string) => dispatch({ kind: "splitOff", args: [id] })
  const renameParty = (partyId: string, name: string) => dispatch({ kind: "renameParty", args: [partyId, name] })
  const removeCharacter = (id: string) => sendTable({ kind: "removeFromFight", args: [id] })

  return { killCharacter, startTurn, toggleContest, contestMode, toggleAgreeToEnd, agreeAllToEnd, rollContest, endTurn, actionSurge, follow, nextRound, endCombat, continueRound, doneResting, holdOn, letGo, rollMorale, hypeUp, skipMorale, rerollMorale, keepMorale, setTablePressure, rollHeld, defaultToCoward, mock, leadershipRally, breakFree, giveOrder, toggleBreakage, moveToParty, createParty, splitOff, renameParty, removeCharacter }
}
