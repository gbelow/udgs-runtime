import { describe, it, expect } from 'vitest'
import type { SceneState } from '../scene/types'
import type { Viewer } from '../profiles'
import { applySceneCommand, type CommandContext } from '../scene/commands/registry'
import { archer, board, medic, meleeTrained, spearman, towerWarden } from '../scene/fixtures'
import { addAffliction } from '../character/commands/addAffliction'
import { getInjuryCapacity } from '../character/rules/afflictions'
import { getAvailableActions, getGoBar } from '../scene/rules/options'
import { getOpenAction } from '../scene/rules/log'
import { getHeldOf } from '../scene/rules/hold'
import { getRoundPhase } from '../scene/rules/roundChange'
import { getMedicineCost } from '../scene/rules/medicine'
import { getSceneSeenBy } from '../scene/projections/seen'
import { getFreeAttackOptions } from '../scene/rules/attack'
import { getOpenChoices } from '../scene/projections/choices'
import { seededRng, rollD10 } from '../play/dice'
import { declare } from './declare'
import { attackIntent } from './moves'
import { getPair } from './pairs'
import { THREAT_WEIGHTS, threatBox } from './boxes/threat'
import { BOT_BOXES } from './bots'
import type { SeatMemories } from './memory'
import { getNextMove, noteSeats, withNoted, type MoveOptions, type Seat } from './seat'

const GM: Viewer = { profile: null, role: 'gm', gmMode: true, profiles: [], ownerOf: () => undefined }

// A person answered a bot's action with an opportunity attack, and the moment
// they picked its row the bot went on, before they could aim it or make it
// heavy.
describe('an opportunity attack a person is still choosing', () => {
  const rng = seededRng(1)
  const ctx: CommandContext = { thrower: (e) => rollD10(e, rng), newId: (() => { let n = 0; return () => `o${++n}` })() }
  const send = (s: SceneState, ...commands: Parameters<typeof applySceneCommand>[1][]) => commands.reduce((at, c) => applySceneCommand(at, c, GM, ctx), s)
  const begun = send(board({ a: [0, 0], d: [1, 0] }, archer('a'), spearman('d')), { kind: 'startTurn', args: ['a'] }, { kind: 'closeContest', args: [] })
  const opportunity = (s: SceneState) => getAvailableActions(s, 'd').find((o) => o.available && o.draft.kind === 'opportunityAttack')
  const drawn = getAvailableActions(begun, 'a')
    .filter((o) => o.available && o.draft.kind === 'gear')
    .map((o) => send(begun, { kind: 'declare', args: ['a', o.draft] }, { kind: 'commit', args: [] }))
    .find((s) => getOpenAction(s)?.step === 'react' && opportunity(s))
  const row = getFreeAttackOptions(begun, begun.characters.d, 'strike')[0]
  const move = (s: SceneState, box: Seat['box']) => getNextMove(s, [{ id: 'a', members: ['a'], box }], { ctx, botDice: () => 5, rngOf: () => rng, autoTable: false }).move

  it('is waited for until they say they are done, whatever they change', () => {
    if (!drawn) throw new Error('nothing drew an opportunity attack')
    const picked = send(drawn, { kind: 'react', args: ['d', opportunity(drawn)!.draft] }, { kind: 'amendReaction', args: ['d', { weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }] })
    const done = send(picked, { kind: 'confirmReaction', args: ['d'] })
    const changed = send(done, { kind: 'amendReaction', args: ['d', { location: 'head' }] })
    for (const box of Object.values(BOT_BOXES)) {
      expect(move(picked, box)).toBeNull()
      expect(move(done, box)?.commands.map((c) => c.kind)).toEqual(['pay'])
      expect(move(changed, box)).toBeNull()
    }
  })

  // Whoever was shown only the reactor's token was told they could not pay for
  // it, and could never go on.
  it('leaves the actor shown only their token to go on', () => {
    if (!drawn) throw new Error('nothing drew an opportunity attack')
    const done = send(drawn, { kind: 'react', args: ['d', opportunity(drawn)!.draft] }, { kind: 'amendReaction', args: ['d', { weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }] }, { kind: 'confirmReaction', args: ['d'] })
    const seen = getSceneSeenBy(done, new Set(['a']))
    expect(seen.characters.d.shown).toBeTruthy()
    expect(getGoBar(seen, getOpenAction(seen)!)).toBeNull()
  })
})

// A prone defender who had learned Technical Lift answered a strike with an
// evasive jump. The cell it landed on was still offered as not chosen, so its
// bot clicked it again after every change, and the attacker's bot, waiting to
// roll, was never asked: the fight stuck.
describe('a strike answered with an evasive jump from the ground', () => {
  const rng = seededRng(1)
  const ctx: CommandContext = { thrower: (e) => rollD10(e, rng), newId: (() => { let n = 0; return () => `t${++n}` })() }
  const send = (s: SceneState, ...commands: Parameters<typeof applySceneCommand>[1][]) => commands.reduce((at, c) => applySceneCommand(at, c, GM, ctx), s)

  let s: SceneState = board({ a: [0, 0], d: [1, 0] }, spearman('a'), addAffliction('prone')(meleeTrained(spearman('d'))))
  s = send(s, { kind: 'startTurn', args: ['a'] }, { kind: 'closeContest', args: [] })
  const row = getFreeAttackOptions(s, s.characters.a, 'strike')[0]
  const strike = declare(s, { actorId: 'a', option: { kind: 'strike' }, picks: [{ part: 'row', value: { weaponKey: row.weaponKey, attack: row.attack, variant: row.variant } }, { part: 'target', value: 'd' }] }, ctx)
  if (!strike.ok) throw new Error(strike.refused)
  s = send(s, ...strike.commands)
  const landing = getOpenChoices(s).find((c) => c.actorId === 'd' && c.part === 'cell')
  if (!landing) throw new Error('no landing offered')
  const jumped = send(s, landing.command)

  it('offers the landing it was clicked to as chosen, and no other', () => {
    const offered = getOpenChoices(jumped).filter((c) => c.actorId === 'd' && c.part === 'cell')
    expect(offered.filter((c) => c.chosen).map((c) => c.value)).toEqual([landing.value])
  })

  // Against a person's strike, whose roll the bot cannot press, it picked its
  // landing again and again, undoing the last.
  it('is not picked again while the attacker is a person', () => {
    const opts: MoveOptions = { ctx, botDice: () => 5, rngOf: () => rng, autoTable: false }
    for (const box of Object.values(BOT_BOXES)) expect(getNextMove(jumped, [{ id: 'd', members: ['d'], box }], opts).move).toBeNull()
  })

  // The panel of whoever is shown only the defender's token read it as unable
  // to pay for its answer, and kept the attacker from rolling.
  it('leaves the attacker shown only a token to roll', () => {
    const seen = getSceneSeenBy(jumped, new Set(['a']))
    const open = getOpenAction(seen)
    expect(open && getGoBar(seen, open)).toBe(getGoBar(jumped, getOpenAction(jumped)!))
  })

  it("comes to the attacker's roll with bots on both seats", () => {
    const seats: Seat[] = [{ id: 'd', members: ['d'], box: threatBox(THREAT_WEIGHTS) }, { id: 'a', members: ['a'], box: threatBox(THREAT_WEIGHTS) }]
    const opts: MoveOptions = { ctx, botDice: (e) => rollD10(e, rng), rngOf: () => rng, autoTable: false }
    let at = jumped
    let from = 0
    let rolled = false
    for (let i = 0; i < 10 && !rolled; i++) {
      const { move, next } = getNextMove(at, seats, opts, from)
      if (!move) break
      rolled = move.by === 'a' && move.commands.some((c) => c.kind === 'roll')
      at = move.commands.reduce((s, c) => applySceneCommand(s, c, move.viewer, ctx), at)
      from = next
    }
    expect(rolled).toBe(true)
  })
})

// A bot with a body shield never guarded a shot: the guard it named was
// offered beside the guard that takes cover, so it was refused as naming two.
describe('a shot at someone with a body shield', () => {
  const rng = seededRng(1)
  const ctx: CommandContext = { thrower: (e) => rollD10(e, rng), newId: (() => { let n = 0; return () => `t${++n}` })() }
  const send = (s: SceneState, ...commands: Parameters<typeof applySceneCommand>[1][]) => commands.reduce((at, c) => applySceneCommand(at, c, GM, ctx), s)

  let s: SceneState = board({ a: [0, 0], d: [5, 0] }, archer('a'), towerWarden('d'))
  s = send(s, { kind: 'startTurn', args: ['a'] }, { kind: 'closeContest', args: [] }, { kind: 'surge', args: ['a', 'focus'] })
  const attack = getPair(s.characters.a, s.characters.d).find((a) => a.kind === 'shoot')
  if (!attack) throw new Error('no shot to make')
  const shot = declare(s, attackIntent('a', attack, 'd'), ctx)
  if (!shot.ok) throw new Error(shot.refused)
  s = send(s, ...shot.commands)
  const guards = getAvailableActions(s, 'd').filter((o) => o.available && o.draft.kind === 'guard')

  it('is answered with each guard offered, named as it is offered', () => {
    expect(guards.length).toBeGreaterThan(1)
    for (const { draft } of guards) expect(declare(s, { actorId: 'd', option: draft, picks: [] }, ctx)).toMatchObject({ ok: true })
  })
})

// The spec box crossed the step of a block off as it decided it. A move decided
// while the turn could still be contested is not made but asked for again, and
// by then the step was gone: the surge was skipped and the walk made without it.
describe('a move asked for again before it is made', () => {
  it.each(Object.entries(BOT_BOXES))('is the same move: %s', (_, box) => {
    const rng = seededRng(1)
    const ctx: CommandContext = { thrower: (e) => rollD10(e, rng), newId: (() => { let n = 0; return () => `t${++n}` })() }
    const seats: Seat[] = [{ id: 'red', members: ['a'], box }, { id: 'blue', members: ['b'], box }]
    let s: SceneState = board({ a: [0, 0], b: [7, 0] }, spearman('a'), spearman('b'))
    let memories: SeatMemories = {}
    let from = 0
    for (let i = 0; i < 10; i++) {
      memories = noteSeats(memories, s, seats)
      const opts: MoveOptions = { ctx: { ...ctx, newId: () => 'x' }, botDice: () => 5, rngOf: () => rng, autoTable: true, memories }
      const { move, next } = getNextMove(s, seats, opts, from)
      const again = getNextMove(s, seats, opts, from).move
      expect(again?.commands, `${i}: ${move?.why}`).toEqual(move?.commands)
      if (!move) break
      memories = withNoted(memories, move)
      s = move.commands.reduce((at, c) => applySceneCommand(at, c, move.viewer, ctx), s)
      from = next
    }
  })
})

// A bot collapsed with less AP than its care takes held it over, then held
// on at every round change however much it had paid in, and bled out.
describe('a bot holding an action over to the next round', () => {
  const bleeding = medic('a')
  const price = getMedicineCost('firstAid').AP
  const tender = { ...bleeding, usedSurge: 'focus' as const, resources: { ...bleeding.resources, AP: price - 1, STA: 6 }, injuries: { ...bleeding.injuries, bleed: 1, injuryLevel: getInjuryCapacity(bleeding) } }
  const rng = seededRng(1)
  const ctx: CommandContext = { thrower: (e) => rollD10(e, rng), newId: (() => { let n = 0; return () => `h${++n}` })() }
  const send = (s: SceneState, ...commands: Parameters<typeof applySceneCommand>[1][]) => commands.reduce((at, c) => applySceneCommand(at, c, GM, ctx), s)
  let s: SceneState = board({ a: [0, 0] }, tender)
  s = send(s, { kind: 'startTurn', args: ['a'] }, { kind: 'closeContest', args: [] })
  const tend = declare(s, { actorId: 'a', option: { kind: 'firstAid' }, picks: [{ part: 'target', value: 'a' }] }, ctx)
  if (!tend.ok) throw new Error(tend.refused)
  s = send(s, ...tend.commands, { kind: 'endTurn', args: [] }, { kind: 'nextRound', args: [] })

  it('finishes it once it has the AP for it, whatever box it plays with', () => {
    expect(getHeldOf(s, 'a')?.kind).toBe('firstAid')
    for (const box of Object.values(BOT_BOXES)) {
      const opts: MoveOptions = { ctx, botDice: () => 5, rngOf: () => rng, autoTable: true }
      let at = s
      for (let i = 0; i < 30 && getRoundPhase(at) !== null; i++) {
        const move = getNextMove(at, [{ id: 'a', members: ['a'], box }], opts).move
        if (!move) break
        at = send(at, ...move.commands)
      }
      expect(getRoundPhase(at)).toBeNull()
      expect(getHeldOf(at, 'a')).toBeNull()
    }
  })
})
