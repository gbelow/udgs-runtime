import { describe, it, expect } from 'vitest'
import { receive } from './money'
import { getPayable } from '../rules/money'
import { makeCharacter } from '../../factories'
import human from '../../../assets/characters/Human.json'
import spearman from '../../../assets/characters/Human Spearman.json'

// Downtime paid a job's wage into characters with no regular slot to keep it
// in (Human wears no container; the Spearman's belt has only quick slots and
// both hands are full), and the coins were silently dropped.
describe('receive', () => {
  it.each([['Human', human], ['Human Spearman', spearman]] as const)('keeps every coin paid to %s', (_name, raw) => {
    const c = makeCharacter(raw)
    expect(getPayable(receive(40)(c))).toBe(getPayable(c) + 40)
  })
})
