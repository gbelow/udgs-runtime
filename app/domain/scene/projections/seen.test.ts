import { expect, it } from 'vitest'
import { PlacementSchema, SceneStateSchema, TerrainCellSchema, type SceneState } from '../types'
import { amendAction, commitAction, declareAction } from '../commands/action'
import { beginTurn } from '../commands/sequence'
import { getOpenAction } from '../rules/log'
import { getAwaited } from '../rules/options'
import { spearman } from '../fixtures'
import { getSceneSeenBy } from './seen'

// A hider heard by the noise of a move of theirs was owed an answer by someone
// shown nothing of the move, and the fight waited on them for good.
it('shows an action to whoever owes it an answer, however well its actor hides', () => {
  const fighter = (id: string) => {
    const base = spearman(id)
    return { ...base, id, resources: { ...base.resources, AP: 30, STA: 10 } }
  }
  const fog = TerrainCellSchema.parse({ visibility: 'zero' })
  const start: SceneState = {
    ...SceneStateSchema.parse({ board: {
      placements: { o: PlacementSchema.parse({ cell: { q: 0, r: 0 } }), t: PlacementSchema.parse({ cell: { q: 3, r: 0 } }) },
      terrain: Object.fromEntries(['1,0', '2,0', '3,0'].map((k) => [k, fog])),
    } }),
    characters: { o: fighter('o'), t: fighter('t') },
    partyOf: { o: 'a', t: 'b' },
    round: 1,
  }
  let n = 0
  const newId = () => `a${++n}`
  let owed = 0
  for (let score = -30; score <= 30; score++) {
    const hidden: SceneState = { ...start, heldTests: [{ id: 't', kind: 'stealth', roll: { mode: 'normal', die: 1, skill: 0, score, skillTerms: [] } }] }
    const declared = amendAction({ movement: 'walk', path: [{ q: 2, r: 0 }, { q: 1, r: 0 }] })(declareAction('t', { kind: 'move' }, newId)(beginTurn(hidden, 't')))
    const state = commitAction(() => 5, newId)(declared)
    if (!getAwaited(state).includes('o')) continue
    owed++
    expect(getOpenAction(getSceneSeenBy(state, new Set(['o'])))?.id, `stealth ${score}`).toBe(getOpenAction(state)?.id)
  }
  expect(owed).toBeGreaterThan(0)
})
