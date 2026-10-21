import { describe, it, expect } from 'vitest'
import { impose, updateCharacter } from './characters'
import { resolvePending } from '../../character/commands/deliver'
import { getImposed, IMPOSE_DRAFT, IMPOSE_EFFECTS } from '../rules/impose'
import { SceneStateSchema, type SceneState } from '../types'
import { makeCampaignCharacter } from '../../factories'

function scene(): SceneState {
  const [a, b] = ['a', 'b'].map((id) => ({ ...makeCampaignCharacter({}), id }))
  return { ...SceneStateSchema.parse({}), characters: { a, b } }
}

const DICE = [1, 3, 5, 8, 10, 15, 20]

describe('impose', () => {
  // The scene is a persisted value and the log is what the table reads back:
  // whatever the GM lays on, whatever the dice say, the fight stays one the
  // schema accepts and storage round-trips, nothing is left waiting once every
  // owed test is rolled, and the call and the roll are both in the log.
  for (const effect of IMPOSE_EFFECTS) {
    it(`${effect}: a test called and rolled leaves a valid fight, nothing owed, both steps logged`, () => {
      for (const die of DICE) {
        const called = impose(['a', 'b'], getImposed({ ...IMPOSE_DRAFT, effect }))(scene())
        expect(called.edits.map((e) => e.cause)).toEqual(['GM called a test', 'GM called a test'])
        const rolled = ['a', 'b'].reduce((state, id) => updateCharacter(id, resolvePending(0, () => die), 'called test')(state), called)
        expect(Object.values(rolled.characters).every((c) => c.pending.length === 0)).toBe(true)
        expect(rolled.edits.filter((e) => e.cause === 'called test').length).toBeGreaterThan(0)
        const parsed = SceneStateSchema.parse(JSON.parse(JSON.stringify(rolled)))
        expect(parsed.edits).toEqual(rolled.edits)
      }
    })
  }
})
