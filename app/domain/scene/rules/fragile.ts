import type { AfflictionKey, CampaignCharacter } from '../../types'
import type { Term } from '../../character/rules/terms'
import type { SceneState } from '../types'
import { getAfflictions } from '../../character/rules/afflictions'
import { getLearnedAbilities } from '../../character/rules/effects'
import { getSituationalAfflictions } from './situational'

// abilities.tex "Exploit Weakness": "characters affected by any mind altering
// status effects": the morale states and domination (the table's ruling).
const MIND_ALTERED: readonly AfflictionKey[] = ['afraid', 'enraged', 'confused', 'dominated']

// Whether the character is mentally weakened as the fight stands.
export function isFragile(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && getAfflictions(c, getSituationalAfflictions(state, id)).some((a) => MIND_ALTERED.includes(a))
}

// abilities.tex "Exploit Weakness": "Also increases the DL of any spells used
// against such characters", by what the edge gives a test (the table's
// ruling), one line per ability.
export function getFragileDLTerms(state: SceneState, caster: CampaignCharacter, targetId: string): Term[] {
  if (!isFragile(state, targetId)) return []
  return getLearnedAbilities(caster).flatMap((a) => a.recipes.flatMap((r) => (r.type === 'edge' && r.when === 'fragile' ? [{ label: a.family, value: r.hit }] : [])))
}
