import type { CombatState } from '../../app/domain/combat/types'
import type { Party } from '../../app/domain/bot/party'
import { archer, board, spearman } from '../../app/domain/bot/fixtures'

// Fights for the simulator to play: who stands where, and which of them a bot
// plays. A character in no party takes no turn and answers nothing.

export type Scenario = {
  name: string
  about: string
  build: () => { state: CombatState; parties: Party[]; labels: string[] }
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'duel',
    about: 'two spearmen, six cells apart, a bot each',
    build: () => ({ state: board({ a: [0, 0], b: [6, 0] }, spearman('a'), spearman('b')), parties: [{ members: ['a'] }, { members: ['b'] }], labels: ['a', 'b'] }),
  },
  {
    name: 'archer',
    about: 'an archer against a spearman, eight cells apart, a bot each',
    build: () => ({ state: board({ a: [0, 0], b: [8, 0] }, archer('a'), spearman('b')), parties: [{ members: ['a'] }, { members: ['b'] }], labels: ['archer', 'spearman'] }),
  },
  {
    name: 'dummy',
    about: 'a bot spearman against a spearman who does nothing',
    build: () => ({ state: board({ a: [0, 0], b: [4, 0] }, spearman('a'), spearman('b')), parties: [{ members: ['a'] }], labels: ['bot'] }),
  },
  {
    name: 'pack',
    about: 'two bot spearmen against one, six cells apart',
    build: () => ({ state: board({ a1: [0, 0], a2: [0, 1], b: [6, 0] }, spearman('a1'), spearman('a2'), spearman('b')), parties: [{ members: ['a1', 'a2'] }, { members: ['b'] }], labels: ['pair', 'lone'] }),
  },
]
