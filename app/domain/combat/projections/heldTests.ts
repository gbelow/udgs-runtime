import type { CombatState } from '../types'
import { getFightName } from '../rules/fighters'
import { getHeldBar, type HeldKind } from '../rules/heldRoll'
import type { RollMode } from '../dice'
import { getHeldModes, getHeldTest } from '../rules/heldTest'
import { getDegree } from '../rules/test'
import { perState } from './perState'

export type HeldTestRow = {
  id: string
  name: string
  kind: HeldKind
  DL: number
  // the ways the test may be rolled
  modes: readonly RollMode[]
  // why the test cannot be rolled now, null while it waits to be
  bar: string | null
  // the test as it was made, '' before it is
  result: string
}

// The tests the round called, whose score then stands for the round: who is
// owed one, and once made, what it was.
function buildHeldRows(state: CombatState): HeldTestRow[] {
  return state.heldTests.filter((t) => state.characters[t.id]).map(({ id, kind, roll }) => {
    const test = getHeldTest(state, id, kind)
    const DL = test?.DL ?? 0
    return {
      id,
      name: getFightName(state, id),
      kind,
      DL,
      modes: getHeldModes(state.characters[id], kind),
      bar: getHeldBar(state, id, kind),
      result: roll ? `${roll.mode} · ${kind} ${roll.skill} + die ${roll.die} = ${roll.score} vs DL ${DL} → ${getDegree(roll.score, DL)}` : '',
    }
  })
}

export const getHeldRows = perState(buildHeldRows)

export const getHeldDigest = perState((state) => JSON.stringify(getHeldRows(state)))
