import { describe, it, expect } from 'vitest'
import type { SceneState } from '../scene/types'
import type { Viewer } from '../profiles'
import { applySceneCommand, type CommandContext } from '../scene/commands/registry'
import { archer, board, meleeTrained, spearman, towerWarden } from '../scene/fixtures'
import { addAffliction } from '../character/commands/addAffliction'
import { getAvailableActions } from '../scene/rules/options'
import { getFreeAttackOptions } from '../scene/rules/attack'
import { getOpenChoices } from '../scene/projections/choices'
import { seededRng, rollD10 } from '../play/dice'
import { declare } from './declare'
import { attackIntent } from './moves'
import { getPair } from './pairs'
import { THREAT_WEIGHTS, threatBox } from './boxes/threat'
import { getNextMove, type MoveOptions, type Seat } from './seat'

const GM: Viewer = { profile: null, role: 'gm', gmMode: true, profiles: [], ownerOf: () => undefined }

// A prone defender who had learned Technical Lift answered a strike with an
// evasive jump. The cell it landed on was still offered as not chosen, so its
// bot clicked it again after every change, and the attacker's bot, waiting to
// roll, was never asked: the fight stuck.
describe('a strike answered with an evasive jump from the ground', () => {
  const rng = seededRng(1)
  const ctx: CommandContext = { thrower: (e) => rollD10(e, rng), newId: (() => { let n = 0; return () => `t${++n}` })() }
  const send = (s: SceneState, ...commands: Parameters<typeof applySceneCommand>[1][]) => commands.reduce((at, c) => applySceneCommand(at, c, GM, ctx), s)

  let s: SceneState = board({ a: [0, 0], d: [1, 0] }, spearman('a'), addAffliction('prone')(meleeTrained(spearman('d'))))
  s = send(s, { kind: 'startTurn', args: ['a'] })
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
  s = send(s, { kind: 'startTurn', args: ['a'] }, { kind: 'surge', args: ['a', 'focus'] })
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
