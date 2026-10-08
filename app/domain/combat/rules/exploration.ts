import type { CampaignCharacter } from '../../types'
import type { ExplorationAction } from '../../lists'
import type { CombatState } from '../types'
import { getSTA } from '../../character/rules/characteristics'
import { getHealth } from '../../character/rules/skills'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { getOpenAction } from './log'

// survival.tex "Wear": "The standard wear is 1 IL + 1 exhaustion per ET";
// "STA < 10 = +1 IL per ET. STA < 8 = +2 IL per ET, STA < 6 = +3 IL and so
// on", read off the derived STA (the table's ruling); combat.tex "Lame":
// "Takes +2 IL for traveling and Searching".
export function getWear(c: CampaignCharacter, action: ExplorationAction): { IL: number; exhaustion: number } {
  const stamina = Math.max(0, Math.floor((11 - getSTA(c)) / 2))
  const lame = action !== 'prepare' && hasAffliction(c, 'lame') ? 2 : 0
  return { IL: 1 + stamina + lame, exhaustion: 1 }
}

// survival.tex "Sleep": "The character heals IL equal to
// 3+(health-exposure)/2"; "If 3+(health-exposure)/2 is lower than 0, it is
// impossible to rest or sleep."
export function getRestHealing(c: CampaignCharacter, exposure: number): number {
  return 3 + Math.floor((getHealth(c) - exposure) / 2)
}

// survival.tex "Sleep": the exhaustion left after sleeping, as
// floor((exhaustion + exposure)/2) — the table's ruling over the book's
// "exhaustion/2 - exposure", so rough ground can leave it worse.
export function getSleptExhaustion(c: CampaignCharacter, exposure: number): number {
  return Math.floor((c.resources.exhaustion + exposure) / 2)
}

// Why the character cannot spend an exploration turn now: the ET loop runs
// outside a fight.
export function getExplorationBar(state: CombatState, id: string): string | null {
  const c = state.characters[id]
  if (!c) return 'no such character'
  if (state.round > 0) return 'a fight is running'
  if (isDead(c)) return 'dead'
  return null
}

// Why the character cannot rest or sleep on this ground.
export function getRestBar(state: CombatState, id: string, exposure: number): string | null {
  const bar = getExplorationBar(state, id)
  if (bar) return bar
  return getRestHealing(state.characters[id], exposure) < 0 ? 'too exposed to rest' : null
}

// Why the fight cannot be ended now: there must be one, and nothing being
// played out in it.
export function getEndCombatBar(state: CombatState): string | null {
  if (state.round === 0) return 'no fight is running'
  return getOpenAction(state) ? 'an action is being played out' : null
}
