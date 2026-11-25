import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { archer, fighter } from '../domain/scene/fixtures'
import { FORGET_AFTER, ROUND_AP } from '../domain/tables'
import { getSceneSeenBy } from '../domain/scene/projections/seen'
import { getActionOffers } from '../domain/scene/projections/actionPanel'
import { getSightOf } from '../domain/scene/rules/seen'
import { UNSEEN_NAME } from '../domain/scene/rules/contest'
import { getAbsentFoes, remember, withRemembered, type SeatMemory } from '../domain/bot/memory'
import { getBelief } from '../domain/bot/belief'

// The table's rulings on faces and places: a face is known from the moment it is
// detected, for the rest of the fight; where its bearer stands, only while they
// are sensed, and remembered for FORGET_AFTER rounds; an exchange shows its
// parties only while it is in play.

const WALL: [number, number][] = Array.from({ length: 11 }, (_, i) => [2, i - 6])

function scene(foe = fighter('Foe')): Harness {
  const h = openHarness(() => 5)
  h.bring(fighter('Ann'), foe)
  h.createBoard(6)
  for (const [name, q, r] of [['Ann', 0, 0], ['Foe', 4, 0]] as const) {
    h.select(name)
    h.cell(q, r)
  }
  h.press((s) => ({ ...s, parties: { ours: { ...Object.values(s.parties)[0], name: 'ours' }, theirs: { ...Object.values(s.parties)[0], name: 'theirs' } }, partyOf: { [h.idOf('Ann')]: 'ours', [h.idOf('Foe')]: 'theirs' } }))
  h.send({ kind: 'light', args: ['bright'] })
  h.send({ kind: 'nextRound', args: [] })
  for (let i = 0; i < 8 && h.state().roundStep !== null; i++) h.send({ kind: 'continueRound', args: [] })
  return h
}

const view = (h: Harness) => getSceneSeenBy(h.state(), new Set([h.idOf('Ann')]))
const see = (h: Harness, memory: SeatMemory | undefined) => remember(memory, h.state(), [h.idOf('Ann')])
const believe = (h: Harness, memory: SeatMemory) => withRemembered(getBelief(h.state(), [h.idOf('Ann')], h.idOf('Ann')), memory)

describe('a detected face', () => {
  it('is known once its bearer is out of sight, and where they stand is not', () => {
    const h = scene()
    const foe = h.idOf('Foe')
    expect(h.state().faces[h.idOf('Ann')]).toContain(foe)
    h.paint('wall', WALL)
    const seen = view(h)
    expect(seen.characters[foe]).toBeUndefined()
    expect(seen.board?.placements[foe]).toBeUndefined()
    expect(seen.names[foe]).toBe(h.state().names[foe])
  })

  it('is none for someone who was never detected', () => {
    const h = scene()
    const foe = h.idOf('Foe')
    h.paint('wall', WALL)
    h.press((s) => ({ ...s, faces: {} }))
    expect(view(h).names[foe]).toBeUndefined()
  })
})

describe('an exchange with someone undetected', () => {
  it('shows someone while it is in play, and nobody once it is over', () => {
    const h = scene(archer('Foe'))
    const foe = h.idOf('Foe')
    h.select('Foe')
    h.startTurn()
    h.send({ kind: 'surge', args: [foe, 'focus'] })
    h.pressMenu(h.menu({ on: 'token', id: h.idOf('Ann') })!.entries.find((e) => e.category === 'attack' && e.bar === null && e.press.kind === 'declare' && e.press.aim !== null)!)
    const ammo = getActionOffers(h.state()).ammo[0]
    if (ammo) h.amend({ ammoId: ammo.itemId })
    h.commit()
    // the light goes out, with the shot still to be answered
    h.press((s) => ({ ...s, board: { ...s.board!, light: 'dark' } }))
    h.press((s) => ({ ...s, faces: {}, inTurnCharacter: '', stealthTurns: [] }))
    expect(getSightOf(h.state(), h.idOf('Ann')).has(foe)).toBe(false)
    expect(view(h).names[foe]).toBe(UNSEEN_NAME)
    h.press((s) => ({ ...s, live: [], stack: [] }))
    expect(view(h).characters[foe]).toBeUndefined()
  })
})

describe('what a bot remembers of a foe', () => {
  it('keeps the face for the fight, and the place for as long as it is remembered', () => {
    const h = scene()
    const foe = h.idOf('Foe')
    let memory = see(h, undefined)
    h.paint('wall', WALL)
    memory = see(h, memory)
    expect(memory[foe].placement).not.toBeNull()
    expect(believe(h, memory).board?.placements[foe]).toBeDefined()
    h.press((s) => ({ ...s, round: s.round + FORGET_AFTER + 1 }))
    memory = see(h, memory)
    expect(memory[foe].placement).toBeNull()
    const belief = believe(h, memory)
    expect(belief.characters[foe]).toBeUndefined()
    expect(getAbsentFoes(belief).map((f) => f.id)).toEqual([foe])
  })

  it('takes the foe to have a round of its own again once the round has passed', () => {
    const h = scene()
    const foe = h.idOf('Foe')
    h.press((s) => ({ ...s, characters: { ...s.characters, [foe]: { ...s.characters[foe], usedSurge: 'combat', resources: { ...s.characters[foe].resources, AP: 0 } } } }))
    const memory = see(h, undefined)
    h.paint('wall', WALL)
    expect(believe(h, see(h, memory)).characters[foe].usedSurge).toBe('combat')
    h.press((s) => ({ ...s, round: s.round + 1 }))
    const face = believe(h, see(h, memory)).characters[foe]
    expect(face.usedSurge).toBeNull()
    expect(face.resources.AP).toBe(ROUND_AP)
  })
})
