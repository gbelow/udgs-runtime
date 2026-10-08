import { EXPLORATION_ACTIONS, type ExplorationAction } from '../../lists'
import type { CombatState } from '../types'
import { getExplorationBar, getRestBar, getRestHealing, getSleptExhaustion, getWear } from '../rules/exploration'

export type ExplorationPanel = {
  bar: string | null
  restBar: string | null
  actions: { action: ExplorationAction; IL: number; exhaustion: number }[]
  sleep: { heal: number; exhaustion: number }
  potion: number
}

// survival.tex "Rest, Exhaustion and Healing", "Wear" — what each ET button
// would do to the character on this ground, and why it is closed.
export function getExplorationPanel(state: CombatState, id: string, exposure: number): ExplorationPanel {
  const c = state.characters[id]
  if (!c) return { bar: 'no such character', restBar: 'no such character', actions: [], sleep: { heal: 0, exhaustion: 0 }, potion: 0 }
  return {
    bar: getExplorationBar(state, id),
    restBar: getRestBar(state, id, exposure),
    actions: EXPLORATION_ACTIONS.map((action) => ({ action, ...getWear(c, action) })),
    sleep: { heal: Math.min(Math.max(0, getRestHealing(c, exposure)), c.injuries.injuryLevel), exhaustion: getSleptExhaustion(c, exposure) },
    potion: c.injuries.potion,
  }
}
