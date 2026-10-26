import type { Dice } from '../domain/play/dice'
import { toTable, type Throw } from '../domain/play/calls'
import type { TerrainBrush } from '../domain/types'
import { SceneStateSchema, type ActionDraft, type SceneState, type SeenScene, type Coord, type LightLevel, type Updater } from '../domain/scene/types'
import { getBoardView, type BoardView } from '../domain/scene/projections/boardView'
import { readClick, type Click } from '../domain/scene/commands/click'
import { applySceneCommand, type SceneCommand } from '../domain/scene/commands/registry'
import type { Viewer } from '../domain/profiles'
import { makeCampaignCharacter } from '../domain/factories'
import type { CampaignCharacter } from '../domain/types'
import { useCombatStore } from './useCombatStore'
import { useCampaignStore } from './useCampaignStore'
import { CampaignStateSchema } from '../domain/campaign/types'

// The board as a player works it, over the real combat store: a click goes
// through `readClick`, the same reading of it the hook dispatches, and a button press is the
// command its hook dispatches. Entropy is the one thing handed in: `roll` is
// the die, and `dice` whoever throws what a command calls for — the screen at
// once, or, at a table that rolls its own (`table`), nobody until a die is
// answered. A panel press is sent as the scene command its hook sends, by
// the GM unless another viewer is named.
//
// What the GM sends is written down as it is sent: the fight as it stood once
// the last character was brought in, then each command with the dice it drew,
// so a session can be played again from the record alone (`replay`).
export type SessionRecord = { table: boolean; start: SceneState; sent: { command: SceneCommand; dice: number[] }[] }

const GM: Viewer = { profile: null, role: 'gm', gmMode: true, profiles: [], ownerOf: () => undefined }

const ids = () => {
  let n = 0
  return () => `id-${++n}`
}

export type Harness = ReturnType<typeof openHarness>

export function openHarness(roll: Dice = () => 5, { table = false }: { table?: boolean } = {}) {
  const newId = ids()
  let drawn: number[] = []
  const draw: Dice = (explodes) => {
    const die = roll(explodes)
    drawn.push(die)
    return die
  }
  const dice: Throw = table ? toTable(draw) : draw
  useCombatStore.setState({ ...SceneStateSchema.parse({}), activeCharacterId: null })
  useCampaignStore.setState(CampaignStateSchema.parse({}))
  const record: SessionRecord = { table, start: SceneStateSchema.parse({}), sent: [] }
  let brush: TerrainBrush | null = null
  let reposition = false

  const state = (): SeenScene => useCombatStore.getState()
  const press = (command: Updater) => useCombatStore.getState().updateCombatState(command)
  const send = (command: SceneCommand, viewer: Viewer = GM) => {
    drawn = []
    press((s) => applySceneCommand(s, command, viewer, { thrower: dice, newId }))
    if (viewer === GM) record.sent.push({ command, dice: drawn })
  }
  const click = (c: Click) => {
    const selected = state().activeCharacterId
    const read = readClick(state(), c, { brush, reposition, selected, newId: () => '' })
    if ('select' in read) useCombatStore.getState().setActiveCharacter(read.select)
    else send({ kind: 'click', args: [c, brush, reposition, selected] })
  }

  const idOf = (name: string): string => {
    const found = Object.values(state().characters).find((c) => c.name === name)
    if (!found) throw new Error(`no character named ${name}`)
    return found.id
  }
  const active = (): string | null => state().activeCharacterId

  return {
    state,
    press,
    send,
    record: (): SessionRecord => record,
    click,
    newId,
    dice,
    roll,
    table,
    view: (): BoardView => getBoardView(state()),
    idOf,
    active,

    // the sidebar: bring a character into the fight, and the board into being
    bring: (...who: (string | CampaignCharacter)[]) => {
      who.forEach((w) => useCampaignStore.getState().loadFighter(typeof w === 'string' ? makeCampaignCharacter({ name: w }) : w))
      record.start = SceneStateSchema.parse(state())
      record.sent = []
    },
    createBoard: (radius: number) => send({ kind: 'createBoard', args: [radius] }),
    removeBoard: () => send({ kind: 'removeBoard', args: [] }),
    resizeBoard: (radius: number) => send({ kind: 'resizeBoard', args: [{ q: radius, r: radius, s: radius }] }),
    light: (level: LightLevel) => send({ kind: 'light', args: [level] }),
    surface: (surface: string | null) => send({ kind: 'surface', args: [surface] }),
    laySurface: (cell: Coord, surface: string) => send({ kind: 'laySurface', args: [cell, surface] }),

    // the board
    cell: (q: number, r: number) => click({ on: 'cell', cell: { q, r } }),
    token: (name: string) => click({ on: 'token', id: idOf(name) }),
    floor: (itemId: string) => click({ on: 'floor', itemId }),
    turn: () => click({ on: 'turn' }),
    select: (name: string) => useCombatStore.getState().setActiveCharacter(idOf(name)),
    holdBrush: (b: TerrainBrush | null) => { brush = b },
    // the GM's repositioning tool, held while `run` clicks
    repositioning: (run: () => void) => { reposition = true; try { run() } finally { reposition = false } },
    // the brush held, a click on each cell `times` over, and put down again
    paint: (b: TerrainBrush, cells: [number, number][], times = 1) => {
      brush = b
      for (const [q, r] of cells) for (let i = 0; i < times; i++) click({ on: 'cell', cell: { q, r } })
      brush = null
    },

    // the action panel and turn controls, which act for the active character
    startTurn: () => send({ kind: 'startTurn', args: [active()!] }),
    declare: (draft: ActionDraft) => send({ kind: 'declare', args: [active()!, draft] }),
    amend: (fields: Partial<ActionDraft>) => send({ kind: 'amend', args: [fields] }),
    commit: () => send({ kind: 'commit', args: [] }),
  } as const
}

// A recorded session played again: the fight it started from, and each
// command sent with the dice it drew then. The ids are issued afresh, in the
// same order. The harness is left where the session ended.
export function replay(record: SessionRecord): Harness {
  let queue: number[] = []
  const h = openHarness(() => queue.shift() ?? 0, { table: record.table })
  useCombatStore.setState({ ...record.start, activeCharacterId: null })
  for (const { command, dice } of record.sent) {
    queue = [...dice]
    h.send(command)
  }
  return h
}
