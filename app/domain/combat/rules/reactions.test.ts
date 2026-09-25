import { describe, it, expect } from 'vitest'
import { CombatStateSchema, type CombatState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema, type CampaignCharacter } from '../../types'
import { holdItem, regripItem } from '../../item/commands/hands'
import { getAvailableActions } from './options'
import { getOpenAction } from './log'
import { getTriggers } from './reactions'
import { amendAction, commitAction, declareAction } from '../commands/action'

function fighter(id: string, AP: number): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, fightName: id, resources: { ...base.resources, AP, STA: 6 } }
}

// A spearman (reach 2) stood four cells from a mover who walks straight at
// him, three cells, and the move committed.
function approach(reactorAP: number): CombatState {
  const spear = ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })
  const r = regripItem(spear.id, 2)(holdItem(spear)(fighter('r', reactorAP))) as CampaignCharacter
  let n = 0
  let s: CombatState = {
    ...CombatStateSchema.parse({ board: { placements: { m: { cell: { q: 0, r: 0 } }, r: { cell: { q: 4, r: 0 } } } } }),
    characters: { m: fighter('m', 12), r },
  }
  s = declareAction('m', { kind: 'move' }, () => `a${++n}`)(s)
  s = amendAction({ movement: 'basic', path: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }] })(s)
  return commitAction()(s)
}

describe('opportunity attack against a mover', () => {
  // Fired on the step that brought the mover into range, one step early.
  // combat.tex "Opportunity Attack": "moving towards a melee weapon while
  // within its attack range" — the mover is at distance 2 after step 2 and
  // steps closer, within reach, on step 3.
  it('fires on the step taken within range, not the step that entered it', () => {
    const s = approach(8)
    const trigger = getTriggers(s, getOpenAction(s)!).find((t) => t.kind === 'opportunityAttack')
    expect(trigger?.at).toBe(3)
  })

  // Was offered to a reactor with no AP for the strike it opens, who then
  // had no way back short of cancelling the whole move. combat.tex
  // "Opportunity Attack": "The attack requires the normal AP cost".
  it('is closed to a reactor who cannot pay for a strike', () => {
    const option = getAvailableActions(approach(0), 'r').find((o) => o.draft.kind === 'opportunityAttack')
    expect(option?.available).toBe(false)
  })
})
