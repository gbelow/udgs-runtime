import { describe, it, expect } from 'vitest'
import { rollD10, seededRng } from '../play/dice'
import { getOpenAction } from '../scene/rules/log'
import { getNextRoundBar } from '../scene/rules/turn'
import { nextRound } from '../scene/commands/nextRound'
import { board, spearman } from './fixtures'
import { playBot } from './play'

// play.tex "Combat" and instructions/scene-map.md ("An action waits only where
// someone owes a decision"): when every character is a bot, no decision is
// owed to anyone else, so the table is never left stuck. Each option is tried
// once and valued as it stands: how well the bots choose is not what is asked.
const QUICK = { samples: 1, horizon: 0 }

describe('two bots', () => {
  it.each([1, 2, 3])('hand the table back with nothing open and the round ready to pass (seed %i)', (seed) => {
    const rng = seededRng(seed)
    const dice = (explodes: boolean) => rollD10(explodes, rng)
    let n = 0
    const newId = () => `x${++n}`
    let state = board({ a: [0, 0], b: [6, 0] }, spearman('a'), spearman('b'))
    for (let round = 0; round < 2; round++) {
      state = playBot(state, [{ members: ['a'], tuning: QUICK }, { members: ['b'], tuning: QUICK }], dice, newId)
      expect(getOpenAction(state)).toBeNull()
      expect(getNextRoundBar(state)).toBeNull()
      state = nextRound(dice)(state)
    }
  })
})
