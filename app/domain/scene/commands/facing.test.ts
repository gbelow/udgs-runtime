import { describe, it, expect } from 'vitest'
import { SceneStateSchema, type SceneState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import type { CampaignCharacter } from '../../types'
import { DIRECTIONS, ROTATIONS, add } from '../rules/board/geometry'
import { amendAction, commitAction, declareAction } from './action'

function walker(): CampaignCharacter {
  const base = makeCampaignCharacter({ name: 'w' })
  return { ...base, id: 'w', fightName: 'w', resources: { ...base.resources, AP: 30, STA: 10 } }
}

let n = 0
const newId = () => `a${++n}`

// combat.tex "Vision" turns on which way a character faces, and the table
// holds that to be the way their last action went.
describe('a lone character who walks a step', () => {
  it.each(ROTATIONS)('faces the way it went, stepping %i', (d) => {
    const start = SceneStateSchema.parse({ board: { placements: { w: { cell: { q: 0, r: 0 }, orientation: 0 } } } })
    const s: SceneState = { ...start, characters: { w: walker() }, inTurnCharacter: 'w' }
    const walking = amendAction({ movement: 'basic', path: [add({ q: 0, r: 0 }, DIRECTIONS[d])] })(declareAction('w', { kind: 'move' }, newId)(s))
    const walked = commitAction(() => 5, newId)(walking)
    expect(walked.board!.placements.w.cell).toEqual(add({ q: 0, r: 0 }, DIRECTIONS[d]))
    expect(walked.board!.placements.w.orientation).toBe(d)
  })
})
