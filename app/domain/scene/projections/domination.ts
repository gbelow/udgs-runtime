import type { SceneState } from '../types'
import { getBreakFreeBar, getMockable, getMockeryBar, getMockeryCost } from '../rules/domination'
import { getFightName } from '../rules/fighters'

// abilities.tex "Mockery": the button of a character who has learned it, the
// one it would mock (null while there is nobody), and why it is closed.
export type MockeryView = { target: string | null; AP: number; bar: string | null }

export function getMockeryView(state: SceneState, id: string): MockeryView | null {
  const c = state.characters[id]
  const cost = c ? getMockeryCost(c) : null
  if (!cost) return null
  const mockable = getMockable(state, id)
  return { target: mockable ? getFightName(state, mockable.targetId) : null, AP: cost.AP, bar: getMockeryBar(state, id) }
}

// combat.tex "Dominated": why the character cannot test to break out now,
// or null.
export function getBreakFreeView(state: SceneState, id: string): string | null {
  return getBreakFreeBar(state, id)
}
