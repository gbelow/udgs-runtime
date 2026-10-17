import type { SceneState } from '../types'
import { getLiveReactionsTo, getOpenAction } from './log'

// Whom a press on the action panel acts for, so that the screen lets only
// whoever plays them make it: what the open action asks of it its actor's, a willing target's acceptance the
// target's, and the step back the one whose reaction it takes back. Null when
// the press acts for nobody.
export type PanelPress = 'open' | 'accept' | 'back'

export function getPanelActor(state: SceneState, press: PanelPress): string | null {
  const open = getOpenAction(state)
  switch (press) {
    case 'open': return open?.actorId ?? null
    case 'accept': return open?.targetId ?? null
    case 'back': return open ? getLiveReactionsTo(state, open.id).at(-1)?.actorId ?? null : null
  }
}
