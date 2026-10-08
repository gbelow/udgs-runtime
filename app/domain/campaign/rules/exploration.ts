import type { CampaignCharacter } from '../../types'
import type { ExplorationAction } from '../../lists'
import type { CampaignState, ETPlan, Table } from '../types'
import type { Degree } from '../../combat/types'
import type { Test } from '../../combat/rules/test'
import { getSTA } from '../../character/rules/characteristics'
import { getHealth, getWill } from '../../character/rules/skills'
import { hasAffliction, isDead } from '../../character/rules/afflictions'

// survival.tex "Wear": "The basic wear is to increase IL by +1"; "STA < 8 =
// +1 IL per EA. STA < 6 = +2 IL and so on", read off the derived STA (the
// table's ruling); combat.tex "Lame": "Takes +2 IL for traveling and
// Searching".
export function getWear(c: CampaignCharacter, action: ExplorationAction): number {
  const stamina = Math.max(0, Math.floor((9 - getSTA(c)) / 2))
  const lame = action !== 'prepare' && hasAffliction(c, 'lame') ? 2 : 0
  return 1 + stamina + lame
}

// survival.tex "Rest": "heals IL equal to 1+(health-exposure)/2. Negative
// values work against the character."
export function getRestHealing(c: CampaignCharacter, exposure: number): number {
  return 1 + Math.floor((getHealth(c) - exposure) / 2)
}

// survival.tex "Rest": "lowers exhaustion by 3 - exposure/2 instead of
// increasing it".
export function getRestRecovery(exposure: number): number {
  return 3 - Math.floor(exposure / 2)
}

// survival.tex "Rest": "Resting only heals 3 times per day. Any further
// resting does not heal nor lower exhaustion and just counts as being idle."
const RESTS_PER_DAY = 3

export function canRestHeal(state: CampaignState, id: string): boolean {
  return (state.rests[id] ?? 0) < RESTS_PER_DAY
}

// survival.tex "Exhaustion": "Any ET where the character starts with
// exhaustion at 12 or higher, it has to make a Will test with a DL equal to
// character's exhaustion - 10."
export function getExhaustionTest(c: CampaignCharacter): Test | null {
  const exhaustion = c.resources.exhaustion
  return exhaustion >= 12 ? { skill: getWill(c), DL: exhaustion - 10, explodes: false, scale: 'degrees' } : null
}

// survival.tex "Exhaustion": "If the character grazes or misses, it is forced
// to rest wherever it is."
export function getPlanAfterTest(plan: ETPlan | null, degree: Degree | null): ETPlan | null {
  return degree === 'miss' || degree === 'graze' ? 'rest' : plan
}

// Why the character cannot plan the coming ET or eat and drink now. The ET
// loop runs on the roster; whoever is in a fight is not on it.
export function getExplorationBar(state: CampaignState, id: string): string | null {
  const c = state.characters[id]
  if (!c) return 'not with the party'
  if (isDead(c)) return 'dead'
  return null
}

// Why the ET cannot pass now: it passes for everyone, and a fight is
// counted in rounds until it is over.
export function getPassBar(table: Table): string | null {
  return Object.keys(table.fight.characters).length > 0 ? 'a fight is going on' : null
}
