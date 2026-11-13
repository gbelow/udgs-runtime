import type { CampaignCharacter, Character } from '../../types'
import type { Action, ActionOf, SceneState } from '../types'
import { makeAction } from '../factories'
import { ABILITIES, hasAbility } from '../../abilities'
import { SPELLS } from '../../spells'
import { canAfford, CANNOT_AFFORD } from '../../character/rules/cost'
import { canCastSpell } from '../../character/rules/spells'
import { getSenses } from '../../character/rules/senses'
import { isCampaignCharacter } from '../../utils'
import { getSenseReaches } from './detection'
import { getRootOf } from './log'

export const COUNTERSPELL = 'counterspell'
const SPIRITUAL_STRIKE = 'spiritual-strike'

// abilities.tex "Counterspell": "cast spiritual strike as a reaction against
// anyone within synesthesia range". How far that is for the character, as
// an opportunity attack's is their melee range: 0 for one who has not
// learned it or holds no synesthesia.
export function getCounterspellReach(c: Character): number {
  if (!hasAbility(c, COUNTERSPELL) || !isCampaignCharacter(c) || !(SPIRITUAL_STRIKE in c.spells)) return 0
  const { hasSense, range } = getSenses(c).synesthesia
  return !hasSense ? 0 : range ?? Infinity
}

// Whether the counterspeller's synesthesia takes in the one they would
// strike, where each stands: around walls and through lattices, as the
// sense fills.
export function isInCounterspellReach(state: SceneState, casterId: string, targetId: string): boolean {
  const caster = state.characters[casterId]
  return !!caster && getCounterspellReach(caster) > 0 && getSenseReaches(state, casterId, targetId).some((r) => r.sense === 'synesthesia')
}

// The table's ruling: the Spiritual Strike is cast quickened (spells.tex
// "Quicken Spell"), out of the caster's turn and with no surge.
const QUICKENED = true

// Why the character cannot answer with a counterspell now, or null: the
// ability's price and the cast's, and the cast itself open to them.
export function getCounterspellBar(c: CampaignCharacter, charged: boolean): string | null {
  const spell = SPELLS[SPIRITUAL_STRIKE]
  const own = ABILITIES[COUNTERSPELL].cost
  if (!canAfford(c, { AP: spell.cost.AP + own.AP, STA: spell.cost.STA + own.STA }, charged)) return CANNOT_AFFORD
  return canCastSpell(c, SPIRITUAL_STRIKE, QUICKENED, charged) ? null : 'cannot cast Spiritual Strike'
}

// The Spiritual Strike the counterspell opens, at whoever's action it
// answers (or the one a push moves towards the counterspeller).
export function getCounterspellCast(state: SceneState, reaction: ActionOf<'counterspell'>, id: string): Action | null {
  const root = getRootOf(state, reaction)
  const targetId = reaction.targetId ?? root?.actorId ?? null
  if (!targetId) return null
  return makeAction('cast', { id, actorId: reaction.actorId, key: SPIRITUAL_STRIKE, quicken: QUICKENED, targetId, spawnedBy: reaction.id, step: 'react' })
}
