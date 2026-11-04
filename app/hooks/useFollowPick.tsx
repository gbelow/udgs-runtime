import { useCombatStore } from "../stores/useCombatStore"
import { useFollowPickStore } from "../stores/useFollowPickStore"
import { useSceneDispatch } from "./useSceneDispatch"

// Marking whom the active character follows by clicking them, on the board or
// the roster. The mark itself is the scene's `follow`, which refuses anyone
// who may not be followed.
export function useFollowPick() {
  const dispatch = useSceneDispatch()
  const picking = useFollowPickStore((s) => s.picking)
  const setPicking = useFollowPickStore((s) => s.setPicking)

  const mark = (targetId: string | null) => {
    const id = useCombatStore.getState().activeCharacterId
    if (id) dispatch({ kind: "follow", args: [id, targetId] })
  }

  // Takes the click when a pick is waiting for it; whether it did.
  const take = (targetId: string): boolean => {
    if (!useFollowPickStore.getState().picking) return false
    mark(targetId)
    setPicking(false)
    return true
  }

  return { picking, start: () => setPicking(true), cancel: () => setPicking(false), release: () => mark(null), take }
}
