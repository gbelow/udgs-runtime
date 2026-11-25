import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { fighter } from '../domain/scene/fixtures'
import { FORGET_AFTER } from '../domain/tables'
import { getSightOf } from '../domain/scene/rules/seen'
import { getEyesBoard, getKnown, lookingFrom, noteSights, NO_SIGHTS } from '../domain/scene/projections/sights'

// What a player's screen shows of a foe (the table's rulings): a face noticed is
// known for the rest of the fight, where it stood for FORGET_AFTER rounds, and
// the board shows only what the character looked through takes in or remembers.

const WALL: [number, number][] = Array.from({ length: 11 }, (_, i) => [2, i - 6])

// Ann and Bob on one side, the foe on the other, with nothing between them.
function scene(): Harness {
  const h = openHarness()
  h.bring(fighter('Ann'), fighter('Bob'), fighter('Foe'))
  h.createBoard(6)
  for (const [name, q, r] of [['Ann', 0, 0], ['Bob', -1, 0], ['Foe', 4, 0]] as const) {
    h.select(name)
    h.cell(q, r)
  }
  h.press((s) => ({ ...s, parties: { ours: { ...Object.values(s.parties)[0], name: 'ours' }, theirs: { ...Object.values(s.parties)[0], name: 'theirs' } }, partyOf: { [h.idOf('Ann')]: 'ours', [h.idOf('Bob')]: 'ours', [h.idOf('Foe')]: 'theirs' } }))
  return h
}

const hide = (h: Harness) => h.paint('wall', WALL)
const pass = (h: Harness, rounds: number) => h.press((s) => ({ ...s, round: s.round + rounds }))

describe('a foe that goes out of sight', () => {
  const own = (h: Harness) => [h.idOf('Ann'), h.idOf('Bob')]
  const board = (h: Harness, memory: typeof NO_SIGHTS, through = 'Ann') => getEyesBoard(lookingFrom(h.state(), h.idOf(through)), own(h), memory)

  it('is known by face for the rest of the fight, and drawn where it stood until that is forgotten', () => {
    const h = scene()
    const foe = h.idOf('Foe')
    let memory = noteSights(NO_SIGHTS, h.state(), own(h), true)
    expect(board(h, memory).tokens.find((t) => t.id === foe)).toMatchObject({ heard: false })
    hide(h)
    expect(getSightOf(h.state(), h.idOf('Ann')).has(foe)).toBe(false)
    memory = noteSights(memory, h.state(), own(h), true)
    expect(board(h, memory).tokens.find((t) => t.id === foe)).toMatchObject({ heard: true, targetable: false })
    pass(h, FORGET_AFTER + 1)
    memory = noteSights(memory, h.state(), own(h), true)
    expect(board(h, memory).tokens.some((t) => t.id === foe)).toBe(false)
    expect(getKnown(h.state(), own(h))).toContain(foe)
  })

  it('is neither drawn nor known to those who never noticed it, unless it is heard', () => {
    const h = scene()
    hide(h)
    h.press((s) => ({ ...s, faces: {} }))
    const foe = h.idOf('Foe')
    const memory = noteSights(NO_SIGHTS, h.state(), own(h), true)
    expect(board(h, memory).tokens.some((t) => t.id === foe)).toBe(false)
    expect(getKnown(h.state(), own(h))).not.toContain(foe)
  })

  it('is forgotten where it stood by one who sees nobody there', () => {
    const h = scene()
    const foe = h.idOf('Foe')
    const seen = noteSights(NO_SIGHTS, h.state(), own(h), true)
    h.paint('wall', WALL.map(([, r]) => [5, r - 3] as [number, number]).filter(([q, r]) => Math.abs(q + r) <= 6 && Math.abs(r) <= 6))
    h.select('Foe')
    h.repositioning(() => h.cell(6, 0))
    h.select('Ann')
    expect(getSightOf(h.state(), h.idOf('Ann')).has(foe)).toBe(false)
    expect(seen.places[h.idOf('Ann')][foe]).toBeDefined()
    expect(noteSights(seen, h.state(), own(h), true).places[h.idOf('Ann')][foe]).toBeUndefined()
  })
})
