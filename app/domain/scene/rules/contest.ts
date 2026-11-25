import type { SceneState } from '../types'

// What is kept of a turn's contest while it is asked for, none of it.
export const NO_CONTEST: Pick<SceneState, 'contenders' | 'contestModes' | 'contestWindow' | 'thinking' | 'letGo'> = { contenders: [], contestModes: {}, contestWindow: 'none', thinking: [], letGo: [] }

// Whether the turn under way is still open to be contested, so that nothing
// is committed in it.
export function isContestPending(state: SceneState): boolean {
  return state.contestWindow === 'open' && state.lastContest === null && state.inTurnCharacter !== ''
}

// Why nothing can be committed in the turn now, or null.
export function getContestWait(state: SceneState): string | null {
  return isContestPending(state) ? 'the turn can still be contested' : null
}
