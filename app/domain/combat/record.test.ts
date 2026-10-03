import { describe, it, expect } from 'vitest'
import { rollD10, seededRng } from './dice'
import { nextRound } from './commands/nextRound'
import { sumTerms } from '../character/rules/terms'
import { board, spearman } from '../bot/fixtures'
import { playBot } from '../bot/play'

// character/rules/terms.ts: "the displayed value and the per-term breakdown
// can never drift" — what a record keeps of a roll and a price is the terms
// they were added up from, and the terms add up to what was thrown and paid.
describe('what a played-out action records', () => {
  it.each([1, 2, 3])('adds its terms up to its roll and its cost (seed %i)', (seed) => {
    const rng = seededRng(seed)
    const dice = (explodes: boolean) => rollD10(explodes, rng)
    let n = 0
    const newId = () => `x${++n}`
    let state = board({ a: [0, 0], b: [2, 0] }, spearman('a'), spearman('b'))
    for (let round = 0; round < 2; round++) {
      state = playBot(state, [{ members: ['a'] }, { members: ['b'] }], dice, newId)
      state = nextRound(dice, newId)(state)
    }
    expect(state.record.length).toBeGreaterThan(0)
    for (const action of state.record) {
      if (action.roll) {
        expect(sumTerms(action.roll.skillTerms)).toBe(action.roll.score - action.roll.die)
        expect(sumTerms(action.roll.DLTerms)).toBe(action.roll.DL)
      }
      if (action.cost) {
        expect(action.costTerms.reduce((sum, t) => sum + t.AP, 0)).toBe(action.cost.AP)
        expect(action.costTerms.reduce((sum, t) => sum + t.STA, 0)).toBe(action.cost.STA)
      }
    }
  })
})
