import { describe, it, expect } from 'vitest'
import { rollD10, seededRng } from '../play/dice'
import { nextRound } from './commands/nextRound'
import { sumTerms } from '../character/rules/terms'
import { board, spearman } from '../bot/fixtures'
import { stepBot } from '../bot/step'
import { tableMove } from '../bot/table'
import { getLanded } from './rules/log'

// Every action of a fight played out by two bots, checked as it lands.
describe('what a played-out fight records', () => {
  it.each([1, 2, 3])('keeps its terms, its results and everything that left play (seed %i)', (seed) => {
    const rng = seededRng(seed)
    const dice = (explodes: boolean) => rollD10(explodes, rng)
    let n = 0
    const newId = () => `x${++n}`
    const parties = [{ members: ['a'] }, { members: ['b'] }]
    let state = board({ a: [0, 0], b: [1, 0] }, spearman('a'), spearman('b'))
    let injuries = 0
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 200; i++) {
        const next = stepBot(state, parties, dice, newId) ?? tableMove(state, parties, dice, newId)
        if (!next) break
        const landed = getLanded(next).slice(state.landed.length)

        // character/rules/terms.ts: "the displayed value and the per-term
        // breakdown can never drift"
        for (const action of landed) {
          if (action.roll) {
            expect(sumTerms(action.roll.skillTerms)).toBe(action.roll.score - action.roll.die)
            expect(sumTerms(action.roll.DLTerms)).toBe(action.roll.DL)
          }
          if (action.cost) {
            expect(action.costTerms.reduce((sum, t) => sum + t.AP, 0)).toBe(action.cost.AP)
            expect(action.costTerms.reduce((sum, t) => sum + t.STA, 0)).toBe(action.cost.STA)
          }
        }

        // instructions/scene-map.md, "What is previewed is what lands": the
        // injury a landed action records for a target is the injury they took
        for (const id of ['a', 'b']) {
          const recorded = landed.flatMap((a) => a.results).filter((r) => r.targetId === id).reduce((sum, r) => sum + r.outcome.IL, 0)
          expect(next.characters[id].injuries.injuryLevel - state.characters[id].injuries.injuryLevel).toBe(recorded)
          if (recorded > 0) injuries++
        }

        // what a step's actions record as changed is what changed
        const known = (st: typeof state) => new Map(Object.values(st.actions).map((a) => [a.id, a.changes.length]))
        const was = known(state)
        const added = [
          ...Object.values(next.actions).flatMap((a) => a.changes.slice(was.get(a.id) ?? 0)),
          ...next.edits.slice(state.edits.length).flatMap((e) => e.changes),
        ]
        for (const id of ['a', 'b']) {
          for (const what of ['AP', 'STA', 'injury level']) {
            const recorded = added.filter((c) => c.kind === 'value' && c.id === id && c.what === what).reduce((sum, c) => sum + (c.kind === 'value' ? c.to - c.from : 0), 0)
            const read = (st: typeof state) => (what === 'injury level' ? st.characters[id].injuries.injuryLevel : st.characters[id].resources[what as 'AP' | 'STA'])
            expect(read(next) - read(state)).toBe(recorded)
          }
        }

        // nothing leaves play without landing or reaching the journal, but a
        // draft that was never committed
        const kept = new Set([...Object.values(next.actions), ...next.journal.map((j) => j.action)].map((a) => a.id))
        for (const a of Object.values(state.actions)) {
          const draft = a.step === 'define' && a.reactionTo === null && a.spawnedBy === null && a.followUpOf === null
          expect(kept.has(a.id) || draft).toBe(true)
        }
        state = next
      }
      state = nextRound(dice, newId)(state)
    }
    expect(state.landed.length).toBeGreaterThan(0)
    expect(injuries).toBeGreaterThan(0)
  })
})
