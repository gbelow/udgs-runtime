import type { SceneState } from '../types'
import { getFightName } from '../rules/fighters'
import { getHeldBar } from '../rules/heldRoll'
import type { RollMode } from '../../play/dice'
import { describeHeld, getHeldDL, getHeldModes, isCalledKind, type CalledKind } from '../rules/heldTest'
import { perState } from '../../perState'

export type HeldTestRow = {
  id: string
  name: string
  kind: CalledKind
  // null for a test with no DL
  DL: number | null
  // the ways the test may be rolled
  modes: readonly RollMode[]
  // why the test cannot be rolled now, null while it waits to be
  bar: string | null
  // the test as it was made, '' before it is
  result: string
}

// The tests the round called, whose score then stands for the round: who is
// owed one, and once made, what it was.
function buildHeldRows(state: SceneState): HeldTestRow[] {
  return state.heldTests.flatMap(({ id, kind, roll }) => {
    if (!state.characters[id] || !isCalledKind(kind)) return []
    const DL = getHeldDL(state, id, kind)
    return [{
      id,
      name: getFightName(state, id),
      kind,
      DL,
      modes: getHeldModes(state.characters[id], kind),
      bar: getHeldBar(state, id, kind),
      result: roll ? describeHeld(kind, roll, DL ?? 0) : '',
    }]
  })
}

export const getHeldRows = perState(buildHeldRows)

export const getHeldDigest = perState((state) => JSON.stringify(getHeldRows(state)))
