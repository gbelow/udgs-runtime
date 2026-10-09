import { describe, it, expect } from 'vitest'
import { SceneStateSchema, type Action, type SceneState, type Coord } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema, type CampaignCharacter } from '../../types'
import { holdItem, regripItem } from '../../item/commands/hands'
import { getAvailableActions } from '../rules/options'
import { defRows, getAttackOptions, getDLTerms, getDefendingReaction } from '../rules/attack'
import { archer } from '../../bot/fixtures'
import { getBoardView } from '../projections/boardView'
import { getHistory, getLog, getOpenAction } from '../rules/log'
import { getTriggersFor } from '../rules/reactions'
import { getPrepared, getPreparedZone } from '../rules/prepared'
import { add, coordKey, disk, DIRECTIONS, sameCell } from '../rules/board/geometry'
import { seesAcross } from '../rules/board/board'
import { amendAction, amendReaction, commitAction, declareAction as declareOwnAction, declareReaction, payAction, resolveAction, rollAction, setTarget, withdrawSpawnedAction } from './action'
import { nextRound } from './nextRound'

// combat.tex "Preparing a reaction": "Any action can be prepared on a player's
// turn, but doing so costs 1 AP. This allows the player to create any trigger
// they can imagine for a reaction. They must have enough AP to perform the
// reaction when the trigger occurs. A prepared action can consist of 2 AP of
// movement and one other action, which can also be movement, and can be
// repeated multiple times as long as the trigger happens again. The movement
// part of the action can be skipped when performing the reaction, but the
// other action must be performed. Reacting to anything else while performing
// the prepared action will cancel it. An action stays prepared until the end
// of the round."

const declareAction = (...[actorId, draft, newId]: Parameters<typeof declareOwnAction>) => (s: SceneState) =>
  declareOwnAction(actorId, draft, newId)({ ...s, inTurnCharacter: actorId })

function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, fightName: id, resources: { ...base.resources, AP: 30, STA: 10 } }
}

function spearman(id: string): CampaignCharacter {
  const item = ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })
  return regripItem(item.id, 2)(holdItem(item)(fighter(id)))
}

function onBoard(placements: Record<string, [number, number]>, ...characters: CampaignCharacter[]): SceneState {
  const cells = Object.fromEntries(Object.entries(placements).map(([id, [q, r]]) => [id, { cell: { q, r } }]))
  return { ...SceneStateSchema.parse({ board: { placements: cells } }), characters: Object.fromEntries(characters.map((c) => [c.id, c])) }
}

let n = 0
const newId = () => `a${++n}`
const MISS = 1
const LAND = 5

type Waits = { event: 'enters' | 'sighted'; who?: string | null }

// The character's turn: a strike prepared, with or without the movement it may
// carry, waiting for the trigger.
function prepareStrike(s: SceneState, id: string, waits: Waits = { event: 'enters' }): SceneState {
  const row = getAttackOptions(s.characters[id], 'strike')[0]
  const declared = declareAction(id, { kind: 'prepare' }, newId)(s)
  const filled = amendAction({ main: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant, trigger: { event: waits.event, who: waits.who ?? null } })(declared)
  return commitAction(() => MISS, newId)(filled)
}

const along = (from: number, to: number): Coord[] => Array.from({ length: Math.abs(to - from) }, (_, i) => ({ q: from + (to > from ? i + 1 : -(i + 1)), r: 0 }))

// The mover declares a straight walk along the row to `to`, not yet committed.
function walking(s: SceneState, id: string, from: number, to: number): SceneState {
  return amendAction({ movement: 'basic', path: along(from, to) })(declareAction(id, { kind: 'move' }, newId)(s))
}

const preparedOption = (s: SceneState, id: string) => getAvailableActions(s, id).find((o) => o.draft.kind === 'prepared')
const triggersOf = (s: SceneState, id: string) => getTriggersFor(s, getOpenAction(s)!, id).map((t) => t.kind)

// A spearman at the origin who has prepared a strike with its movement, and a
// mover far along the row; the walk to `to` is declared and committed.
function walkIntoIt(to: number, { waits }: { waits?: Waits } = {}): SceneState {
  const s = prepareStrike(onBoard({ p: [0, 0], m: [-10, 0] }, spearman('p'), fighter('m')), 'p', waits)
  return commitAction(() => MISS, newId)(walking(s, 'm', -10, to))
}

// Answers the committed move with the prepared action, and pays for it: the
// mover's move is paid by the table, the preparer's actions open one at a time.
function answered(s: SceneState): SceneState {
  const option = preparedOption(s, 'p')
  if (!option?.available) throw new Error('no prepared action offered')
  return payAction(newId, () => MISS)(declareReaction('p', option.draft, newId)(s))
}

describe('what a preparation waits for', () => {
  // The table's ruling: the area trigger includes the movement range — a
  // mover who stops short of it draws nothing, and one who comes into it does.
  it('fires on a mover who comes into its zone, and not on one who stays outside it', () => {
    const declared = (to: number) => walking(prepareStrike(onBoard({ p: [0, 0], m: [-10, 0] }, spearman('p'), fighter('m')), 'p'), 'm', -10, to)
    const inside = [-9, -8, -7, -6, -5, -4, -3, -2].find((to) => triggersOf(declared(to), 'p').includes('prepared'))
    expect(inside).toBeDefined()
    expect(triggersOf(declared(inside! - 1), 'p')).not.toContain('prepared')
  })

  it('waits only for the one it names', () => {
    const s = prepareStrike(onBoard({ p: [0, 0], m: [-10, 0], x: [-10, 1] }, spearman('p'), fighter('m'), fighter('x')), 'p', { event: 'enters', who: 'x' })
    expect(triggersOf(walking(s, 'm', -10, -2), 'p')).not.toContain('prepared')
  })

  it('is offered to its preparer when the move is committed, and to nobody else', () => {
    const s = walkIntoIt(-2)
    expect(getOpenAction(s)?.step).toBe('react')
    expect(preparedOption(s, 'p')?.available).toBe(true)
    expect(preparedOption(s, 'm')).toBeUndefined()
  })

  it('lapses when the round ends', () => {
    const prepared = prepareStrike(onBoard({ p: [0, 0], m: [-10, 0] }, spearman('p'), fighter('m')), 'p')
    expect(getPrepared(prepared)).toHaveLength(1)
    const later = nextRound(() => MISS, newId)(prepared)
    expect(getPrepared(later)).toHaveLength(0)
    expect(triggersOf(walking(later, 'm', -10, -2), 'p')).not.toContain('prepared')
  })

  // combat.tex "Visibility": a prepared shot "occurs when the target becomes
  // visible" — the step at which the mover comes into sight, from behind cover.
  it('can wait for a mover to come into sight', () => {
    const cover = SceneStateSchema.parse({ board: { placements: { p: { cell: { q: 0, r: 0 } }, m: { cell: { q: -6, r: 0 } } }, terrain: { '-3,0': { blocking: true } } } })
    const s = { ...cover, characters: { p: spearman('p'), m: fighter('m') } }
    const prepared = prepareStrike(s, 'p', { event: 'sighted' })
    const hidden = triggersOf(walking(prepared, 'm', -6, -5), 'p')
    const seen = triggersOf(walking(prepared, 'm', -6, -1), 'p')
    expect(hidden).not.toContain('prepared')
    expect(seen).toContain('prepared')
  })
})

// The preparer's movement, opened first: taken two cells towards the mover,
// who is stood on the cell that brought them into the zone.
const stepsToward = (to: number) => amendAction({ movement: 'basic', path: along(0, to) })

// Plays what is open out with the die showing `face`, taking the SD for
// everyone and passing up any follow-up it is offered, until `until` holds or
// nothing is open.
function playOut(start: SceneState, face: number, until: (s: SceneState) => boolean = () => false): SceneState {
  let s = start
  for (let i = 0; i < 40; i++) {
    const open = getOpenAction(s)
    if (!open || until(s)) return s
    const next = [rollAction(() => face, newId), payAction(newId, () => face), resolveAction(newId), withdrawSpawnedAction(newId)].map((step) => step(s)).find((t) => t !== s)
    if (!next) return s
    s = next
  }
  throw new Error('did not end')
}

const isPreparersMove = (s: SceneState) => { const open = getOpenAction(s); return open?.kind === 'move' && open.actorId === 'p' && open.step === 'define' }
const isPreparersMain = (s: SceneState) => { const open = getOpenAction(s); return open?.kind === 'strike' && open.actorId === 'p' && open.step === 'define' }
const kinds = (s: SceneState, ids: string[]) => ids.map((id) => getLog(s).find((a) => a.id === id)).map((a) => `${a?.actorId} ${a?.kind}`)

describe('firing a prepared action', () => {
  // combat.tex "Reactions": "A reaction takes effect before the action that
  // caused it." The movement it carries comes first, then the action itself.
  it('is done before the move that triggered it, its movement first', () => {
    let s = answered(walkIntoIt(-3))
    expect(isPreparersMove(s)).toBe(true)
    s = commitAction(() => MISS, newId)(stepsToward(-2)(s))
    s = playOut(s, MISS, isPreparersMain)
    expect(isPreparersMain(s)).toBe(true)
    s = commitAction(() => MISS, newId)(setTarget('m')(s))
    s = playOut(s, MISS)
    expect(getOpenAction(s)).toBeNull()
    expect(kinds(s, getHistory(s).slice(-3))).toEqual(['p move', 'p strike', 'm move'])
  })

  // The mover is stood on the cell that brought them into the zone while it
  // is done, and walks on from there unless the action interrupts them
  // (combat.tex "Interruption": "Movement is cancelled").
  describe('against a mover it may interrupt', () => {
    const fought = (face: number) => {
      let s = answered(walkIntoIt(-3))
      s = commitAction(() => MISS, newId)(stepsToward(-2)(s))
      s = playOut(s, MISS, isPreparersMain)
      const zone = getPreparedZone(s, s.characters.p, getPrepared(s)[0])
      expect(s.board?.placements.m?.cell.q).toBe(-zone)
      s = commitAction(() => face, newId)(setTarget('m')(s))
      return { zone, state: playOut(s, face) }
    }

    it('leaves one it interrupts where it stood', () => {
      const { zone, state } = fought(LAND)
      const strike = getLog(state).find((a): a is Extract<Action, { kind: 'strike' }> => a.kind === 'strike' && a.actorId === 'p')
      expect(strike?.interruption).not.toBe('none')
      expect(state.board?.placements.m?.cell.q).toBe(-zone)
    })

    it('lets one it misses walk on', () => {
      const { state } = fought(MISS)
      expect(state.board?.placements.m?.cell.q).toBe(-3)
    })
  })
})

describe('what must be performed', () => {
  const atMovement = (s: SceneState) => { const state = answered(s); expect(isPreparersMove(state)).toBe(true); return state }

  // combat.tex "Preparing a reaction": the movement may be skipped, "but the
  // other action must be performed" — and a strike needs someone in its reach,
  // which here only the movement can bring.
  it('does not let the movement be skipped when the action would then have nobody in reach', () => {
    const s = atMovement(walkIntoIt(-3))
    expect(withdrawSpawnedAction(newId)(s)).toBe(s)
  })

  // A mover who comes into sight already within reach needs no movement of the
  // preparer's to be struck, so it may be skipped.
  it('lets the movement be skipped when the action can be done without it', () => {
    const origin: Coord = { q: 0, r: 0 }
    const wall: Coord = { q: -1, r: 0 }
    const cover = SceneStateSchema.parse({ board: { placements: { p: { cell: origin } }, terrain: { [coordKey(wall)]: { blocking: true } } } })
    const sees = (cell: Coord) => seesAcross(cover.board!, [origin], [cell])
    const open = (cell: Coord) => !sameCell(cell, wall) && !sameCell(cell, origin)
    const steps = disk(origin, 2).filter((to) => open(to) && sees(to)).flatMap((to) => DIRECTIONS.map((d) => add(to, d)).filter((from) => open(from) && !sees(from)).map((from) => ({ from, to })))
    expect(steps.length).toBeGreaterThan(0)
    const { from, to } = steps[0]
    const s = { ...cover, characters: { p: spearman('p'), m: fighter('m') }, board: { ...cover.board!, placements: { ...cover.board!.placements, m: { ...cover.board!.placements.p, cell: from } } } }
    const committed = commitAction(() => MISS, newId)(amendAction({ movement: 'basic', path: [to] })(declareAction('m', { kind: 'move' }, newId)(prepareStrike(s, 'p', { event: 'sighted' }))))
    const opened = atMovement(committed)
    const skipped = withdrawSpawnedAction(newId)(opened)
    expect(skipped).not.toBe(opened)
    expect(isPreparersMain(skipped)).toBe(true)
  })

  it('does not let the action be passed up while there is someone in its reach', () => {
    let s = atMovement(walkIntoIt(-3))
    s = playOut(commitAction(() => MISS, newId)(stepsToward(-2)(s)), MISS, isPreparersMain)
    expect(isPreparersMain(s)).toBe(true)
    expect(withdrawSpawnedAction(newId)(s)).toBe(s)
  })

  // An action nobody is in reach of cannot be performed, so it is passed up
  // rather than left to hold the table.
  it('lets the action be passed up when nobody is in its reach', () => {
    let s = atMovement(walkIntoIt(-3))
    s = playOut(commitAction(() => MISS, newId)(amendAction({ movement: 'basic', path: [{ q: 1, r: 0 }] })(s)), MISS, isPreparersMain)
    expect(isPreparersMain(s)).toBe(true)
    const passed = withdrawSpawnedAction(newId)(s)
    expect(passed).not.toBe(s)
    expect(getOpenAction(playOut(passed, MISS))).toBeNull()
  })
})

// A spearman standing where the preparer's movement towards the mover brings
// it closer to his spear while already within its reach: the movement draws an
// opportunity attack (combat.tex "Opportunity Attack").
function drawingAnAttack(): SceneState {
  const s = prepareStrike(onBoard({ p: [0, 0], m: [-10, 0], s: [-2, 1] }, spearman('p'), fighter('m'), spearman('s')), 'p')
  return commitAction(() => MISS, newId)(walking(s, 'm', -10, -3))
}

// The preparer's movement committed, and the attack it drew declared and about
// to be fought: the spearman's strike at the preparer, waiting for an answer.
function attackedOnTheWay(): SceneState {
  let s = answered(drawingAnAttack())
  s = amendAction({ movement: 'basic', path: [{ q: -1, r: 0 }] })(s)
  s = commitAction(() => MISS, newId)(s)
  const option = getAvailableActions(s, 's').find((o) => o.draft.kind === 'opportunityAttack' && o.available)
  if (!option) throw new Error('the movement drew no attack')
  s = declareReaction('s', option.draft, newId)(s)
  const { weaponKey, attack, variant } = getAttackOptions(s.characters.s, 'strike')[0]
  s = amendReaction('s', { weaponKey, attack, variant })(s)
  s = payAction(newId, () => MISS)(s)
  expect(getOpenAction(s)).toMatchObject({ kind: 'strike', actorId: 's', targetId: 'p' })
  return s
}

const mainOf = (s: SceneState) => getLog(s).find((a) => a.preparedPart === 'main')

describe('reacting to anything else while performing the prepared action', () => {
  // combat.tex "Preparing a reaction": "Reacting to anything else while
  // performing the prepared action will cancel it." Once it is taken, the
  // prepared action is finished (the table's ruling).
  it('cancels it', () => {
    const answeredAttack = declareReaction('p', { kind: 'evade' }, newId)(attackedOnTheWay())
    const state = playOut(answeredAttack, MISS)
    expect(getOpenAction(state)).toBeNull()
    expect(mainOf(state)).toBeUndefined()
  })

  it('leaves it to be performed when the attack on the way is taken on the SD', () => {
    const state = playOut(attackedOnTheWay(), MISS, isPreparersMain)
    expect(isPreparersMain(state)).toBe(true)
    expect(mainOf(state)).toBeDefined()
  })
})

describe('a prepared action', () => {
  // The table's ruling: no chaining. What a prepared action opens never draws
  // another's — the same walk, made on the preparer's own turn, does.
  it('opens nothing that triggers another prepared action', () => {
    const setUp = () => prepareStrike(prepareStrike(onBoard({ p: [0, 0], m: [-10, 0], q: [-5, 1] }, spearman('p'), fighter('m'), spearman('q')), 'p'), 'q', { event: 'enters', who: 'p' })
    const plain = amendAction({ movement: 'basic', path: [{ q: -1, r: 0 }, { q: -2, r: 0 }] })(declareAction('p', { kind: 'move' }, newId)(setUp()))
    expect(triggersOf(plain, 'q')).toContain('prepared')

    const opened = answered(commitAction(() => MISS, newId)(walking(setUp(), 'm', -10, -3)))
    expect(isPreparersMove(opened)).toBe(true)
    const spawned = amendAction({ movement: 'basic', path: [{ q: -1, r: 0 }, { q: -2, r: 0 }] })(opened)
    expect(triggersOf(spawned, 'q')).not.toContain('prepared')
  })
})

// combat.tex "Protect", "Guard": a defense is made for an ally — within one
// space of the line between attacker and target, or next to the target and
// nearer the shooter — and "Preparing a reaction" lets its preparer carry 2 AP
// of movement to get there. The movement is walked before the die, so the
// defense is scored as it stands once they have.
describe('preparing a defense for an ally', () => {
  const shielded = (id: string) => holdItem(ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 2 }))(fighter(id))

  function prepareDefense(s: SceneState, id: string, main: 'block' | 'intercept' | 'guard', who: string | null = null): SceneState {
    const row = defRows(s.characters[id]).find((r) => r.weapon.shield !== undefined)!
    const declared = declareAction(id, { kind: 'prepare' }, newId)(s)
    const filled = amendAction({ main, weaponKey: row.wielded.key, attack: row.atk.name, trigger: { event: 'attacked', who } })(declared)
    return commitAction(() => MISS, newId)(filled)
  }

  // `atk` thrusts at `def`, two spaces along the row; `p` stands at `from`
  function thrust(from: [number, number], extra: Record<string, [number, number]> = {}, others: CampaignCharacter[] = [], who: string | null = null): SceneState {
    let s = onBoard({ atk: [0, 0], def: [2, 0], p: from, ...extra }, spearman('atk'), fighter('def'), shielded('p'), ...others)
    s = prepareDefense(s, 'p', 'block', who)
    const [row] = getAttackOptions(s.characters.atk, 'strike')
    s = declareAction('atk', { kind: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(s)
    return commitAction(() => MISS, newId)(setTarget('def')(s))
  }
  const preparedDefense = (s: SceneState, id: string) => getAvailableActions(s, id).find((o) => (o.draft.kind === 'block' || o.draft.kind === 'guard') && o.draft.preparedId)

  it('is offered to one the movement can put on the line, and not to one it cannot', () => {
    expect(triggersOf(thrust([1, -3]), 'p')).toContain('block')
    expect(triggersOf(thrust([1, -12]), 'p')).not.toContain('block')
  })

  it('waits only for the one it names', () => {
    expect(triggersOf(thrust([1, -3], { x: [5, 5] }, [fighter('x')], 'x'), 'p')).not.toContain('block')
    expect(triggersOf(thrust([1, -3], {}, [], 'def'), 'p')).toContain('block')
  })

  it('is never offered to the one attacked', () => {
    const s = thrust([1, -3])
    expect(preparedDefense(s, 'p')?.available).toBe(true)
    expect(preparedDefense(s, 'def')).toBeUndefined()
  })

  const isRepositioning = (s: SceneState) => { const open = getOpenAction(s); return open?.kind === 'move' && open.actorId === 'p' && open.step === 'define' && open.preparedPart === 'move' }
  const toTheLine = (s: SceneState) => commitAction(() => MISS, newId)(amendAction({ movement: 'basic', path: [{ q: 1, r: -2 }, { q: 1, r: -1 }] })(s))
  const backAtTheAttack = (s: SceneState) => { const open = getOpenAction(s); return (open?.kind === 'strike' || open?.kind === 'shoot') && open.step === 'react' && open.spawnedBy === null }
  const attackOf = (s: SceneState) => getLog(s).find((a) => a.kind === 'strike' || a.kind === 'shoot')!

  // The die is scored against the defense as it stands, so it is not thrown
  // until the preparer has walked to the line.
  it('has the preparer walk to the line before the die is thrown, and the defense counts from there', () => {
    const start = thrust([1, -3])
    let s = declareReaction('p', preparedDefense(start, 'p')!.draft, newId)(start)
    expect(getDefendingReaction(s, getOpenAction(s)!)).toBeNull()
    s = rollAction(() => MISS, newId)(s)
    expect(isRepositioning(s)).toBe(true)
    expect(attackOf(s).roll).toBeNull()
    s = playOut(toTheLine(s), MISS, backAtTheAttack)
    expect(backAtTheAttack(s)).toBe(true)
    expect(s.board?.placements.p?.cell).toEqual({ q: 1, r: -1 })
    expect(getDefendingReaction(s, getOpenAction(s)!)?.actorId).toBe('p')
    expect(getDLTerms(s, getOpenAction(s)!).map((t) => t.label)).toContain('cover')
    expect(attackOf(rollAction(() => MISS, newId)(s)).roll).not.toBeNull()
  })

  // combat.tex "Preparing a reaction": the movement "can be skipped" — by one
  // already on the line, whose defense it leaves made.
  it('lets one already on the line pass the movement up, and not one off it', () => {
    const reposition = (from: [number, number]) => { const start = thrust(from); return rollAction(() => MISS, newId)(declareReaction('p', preparedDefense(start, 'p')!.draft, newId)(start)) }
    const off = reposition([1, -3])
    expect(withdrawSpawnedAction(newId)(off)).toBe(off)
    const on = reposition([1, -1])
    expect(isRepositioning(on)).toBe(true)
    const passed = withdrawSpawnedAction(newId)(on)
    expect(backAtTheAttack(passed)).toBe(true)
    expect(getDLTerms(passed, getOpenAction(passed)!).map((t) => t.label)).toContain('cover')
  })

  // combat.tex "Preparing a reaction": the movement draws opportunity attacks
  // like any other (the table's ruling), fought before the die.
  it('draws opportunity attacks on the way to the line', () => {
    const start = thrust([1, -3], { e: [2, -1] }, [spearman('e')])
    const s = toTheLine(rollAction(() => MISS, newId)(declareReaction('p', preparedDefense(start, 'p')!.draft, newId)(start)))
    expect(getOpenAction(s)).toMatchObject({ kind: 'move', actorId: 'p', step: 'react' })
    expect(triggersOf(s, 'e')).toContain('opportunityAttack')
  })

  // combat.tex "Preparing a reaction": "Reacting to anything else while
  // performing the prepared action will cancel it."
  it('is cancelled by a reaction its preparer makes to what the movement drew', () => {
    const start = thrust([1, -3], { e: [2, -1] }, [spearman('e')])
    let s = toTheLine(rollAction(() => MISS, newId)(declareReaction('p', preparedDefense(start, 'p')!.draft, newId)(start)))
    const attack = getAvailableActions(s, 'e').find((o) => o.draft.kind === 'opportunityAttack' && o.available)!
    s = declareReaction('e', attack.draft, newId)(s)
    const { weaponKey, attack: row, variant } = getAttackOptions(s.characters.e, 'strike')[0]
    s = payAction(newId, () => MISS)(amendReaction('e', { weaponKey, attack: row, variant })(s))
    s = playOut(declareReaction('p', { kind: 'evade' }, newId)(s), MISS, backAtTheAttack)
    expect(getDefendingReaction(s, getOpenAction(s)!)).toBeNull()
  })

  // combat.tex "Guard": "as long as they are closer to the projectile source
  // than the adjacent character" — a guard prepared for an ally stands anywhere
  // along the arrow's way, within a space of the line (the table's ruling).
  describe('as a guard against an arrow', () => {
    const shot = (from: [number, number]) => {
      let s = onBoard({ a: [0, 0], def: [-6, 0], p: from }, archer('a'), fighter('def'), shielded('p'))
      s = prepareDefense(s, 'p', 'guard')
      s = declareAction('a', { kind: 'shoot', weaponKey: s.characters.a.held[0].id, attack: 'shoot', variant: 'basic', ammoId: 'arrows' }, newId)(s)
      return commitAction(() => MISS, newId)(setTarget('def')(s))
    }

    it('is offered to one standing on the way, adjacent to the target or not, and to one the movement can put there', () => {
      expect(triggersOf(shot([-3, 1]), 'p')).toContain('guard')
      expect(triggersOf(shot([-4, 12]), 'p')).not.toContain('guard')
      expect(triggersOf(shot([-4, 3]), 'p')).toContain('guard')
    })

    it('has the guard walk to the way before the die, and offers only the spaces it can be made from', () => {
      const start = shot([-4, 3])
      let s = rollAction(() => MISS, newId)(declareReaction('p', preparedDefense(start, 'p')!.draft, newId)(start))
      expect(isRepositioning(s)).toBe(true)
      const offered = getBoardView(s).cells.filter((c) => c.reachable !== null)
      expect(offered.length).toBeGreaterThan(0)
      expect(offered.every(({ cell }) => Math.abs(cell.r) <= 1)).toBe(true)
      s = playOut(commitAction(() => MISS, newId)(amendAction({ movement: 'basic', path: [{ q: -4, r: 2 }, { q: -4, r: 1 }] })(s)), MISS, backAtTheAttack)
      expect(getDefendingReaction(s, attackOf(s))?.actorId).toBe('p')
    })
  })
})
