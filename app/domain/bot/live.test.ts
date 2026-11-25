import { describe, expect, it } from 'vitest'
import type { SceneState } from '../scene/types'
import type { Viewer } from '../profiles'
import { applySceneCommand, type CommandContext, type SceneCommand } from '../scene/commands/registry'
import { fighter } from '../scene/fixtures'
import { SceneStateSchema } from '../scene/types'
import { addAffliction } from '../character/commands/addAffliction'
import { getOpenButtons } from '../scene/projections/buttons'
import { getRestAwaited } from '../scene/rules/resting'
import { getContenders, getTurnHolder, hasAgreedToEnd } from '../scene/rules/turn'
import { seededRng } from '../play/dice'
import { nearestBox } from './boxes/nearest'
import type { Box } from './decision'
import { getLiveStep, NEW_LIVE, type LiveStep } from './live'
import type { MoveOptions, Seat } from './seat'

const GM: Viewer = { profile: null, role: 'gm', gmMode: true, profiles: [], ownerOf: () => undefined }

// p is a person's, b a bot's, at a table nobody runs as GM.
function table(box: Box, paused = false) {
  let n = 0
  const ctx: CommandContext = { thrower: () => 9, newId: () => `n${++n}` }
  const seats: Seat[] = [{ id: 'bot', members: ['b'], box }]
  const opts: MoveOptions = { ctx, paused, botDice: () => 9, rngOf: () => seededRng(1), autoTable: true }
  let state: SceneState = SceneStateSchema.parse({
    characters: { p: fighter('p'), b: fighter('b') },
    parties: { ours: { name: 'ours' }, theirs: { name: 'theirs' } },
    partyOf: { p: 'ours', b: 'theirs' },
  })
  let live = NEW_LIVE
  const send = (command: SceneCommand, viewer = GM) => {
    const before = state
    state = applySceneCommand(state, command, viewer, ctx)
    return state !== before
  }
  return {
    state: () => state,
    change: (f: (s: SceneState) => SceneState) => { state = f(state) },
    send,
    // what the bots and the table do next, sent
    step: (): LiveStep => {
      const asked = getLiveStep(live, state, seats, opts, 0)
      live = asked.live
      if (asked.step.do === 'press') for (const command of asked.step.move.commands) send(command, asked.step.move.viewer)
      return asked.step
    },
    // the first of these the panel offers p, pressed
    press: (...kinds: SceneCommand['kind'][]): boolean => {
      const open = kinds.flatMap((kind) => getOpenButtons(state).filter(({ command: c }) => c.kind === kind && [c.args[0]].flat()[0] === 'p'))[0]
      return open !== undefined && send(open.command)
    },
  }
}

describe('a round change at a table nobody runs as GM', () => {
  // The table moves a round change on by one press after another, and the
  // bots were stopped as if spinning at the fourth, a morale test among them.
  // The rest step was left at once, with a player who could still rest in it.
  it('is seen through to the next round, and its rest step waits for the players', () => {
    const t = table(nearestBox)
    const left: string[][] = []
    let afraid = false
    for (let i = 0; i < 200 && t.state().round < 3; i++) {
      const before = t.state()
      const step = t.step()
      expect(step.do).not.toBe('stop')
      if (step.do === 'press' && before.roundStep === 'rest' && t.state().roundStep !== 'rest') left.push(getRestAwaited(before).filter((id) => id === 'p'))
      if (step.do === 'press') continue
      const s = t.state()
      if (s.round === 1 && s.roundStep === null && !afraid) {
        afraid = true
        t.change((x) => ({ ...x, characters: { ...x.characters, p: addAffliction('afraid')(x.characters.p) } }))
      }
      const moved = t.press('doneResting', 'rollMorale', 'keepMorale')
        || (s.roundStep === null && !hasAgreedToEnd(s, 'p') && t.send({ kind: 'toggleAgreeToEnd', args: ['p'] }))
      expect(moved, `stuck in round ${s.round}, at ${s.roundStep}`).toBe(true)
    }
    expect(t.state().round).toBe(3)
    expect(left.length).toBeGreaterThan(0)
    expect(left.flat()).toEqual([])
  })
})

describe('a bot that presses the same thing back and forth', () => {
  it('is stopped, and goes on once the fight changes', () => {
    const t = table(({ buttons, members }) => {
      const pick = buttons.find((b) => b.command.kind === 'toggleAgreeToEnd' && b.command.args[0] === members[0])
      return pick ? { kind: 'press', pick, why: 'cannot make up its mind' } : { kind: 'wait', why: '' }
    })
    t.send({ kind: 'nextRound', args: [] })
    for (let i = 0; i < 8 && t.state().roundStep !== null; i++) t.send({ kind: 'continueRound', args: [] })
    let stopped: LiveStep | null = null
    for (let i = 0; i < 40 && !stopped; i++) {
      const step = t.step()
      if (step.do === 'stop') stopped = step
    }
    expect(stopped).toMatchObject({ do: 'stop', first: true })
    expect(t.step()).toMatchObject({ do: 'stop', first: false })
    t.send({ kind: 'toggleAgreeToEnd', args: ['p'] })
    expect(t.step().do).toBe('press')
  })
})

describe('paused bots', () => {
  // Pausing stopped the table's own presses with the bots, so a contest asked
  // for while they were paused was never rolled.
  it('leave the table to roll a contest, and press nothing themselves', () => {
    const t = table(nearestBox, true)
    t.send({ kind: 'nextRound', args: [] })
    for (let i = 0; i < 8 && t.state().roundStep !== null; i++) t.send({ kind: 'continueRound', args: [] })
    t.send({ kind: 'startTurn', args: ['b'] })
    expect(t.step().do).toBe('nothing')
    t.send({ kind: 'toggleContest', args: ['p'] })
    expect(getContenders(t.state())).toEqual(['p'])
    expect(t.step()).toMatchObject({ do: 'press', move: { by: 'table' } })
    expect(t.state().lastContest).not.toBeNull()
    expect(getTurnHolder(t.state())).not.toBeNull()
    expect(t.step().do).toBe('nothing')
  })
})
