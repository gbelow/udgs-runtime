import type { Dice } from '../domain/play/dice'
import { toTable, type Throw } from '../domain/play/calls'
import type { TerrainBrush } from '../domain/types'
import { SceneStateSchema, type ActionDraft, type SceneState, type LightLevel, type Updater } from '../domain/scene/types'
import { getBoardView, type BoardView } from '../domain/scene/projections/boardView'
import { resolveClick, type Click } from '../domain/scene/commands/click'
import { createBoard, removeBoard, setLight } from '../domain/scene/commands/board'
import { applySceneCommand, type SceneCommand } from '../domain/scene/commands/registry'
import type { Viewer } from '../domain/profiles'
import { startTurn } from '../domain/scene/commands/turn'
import { makeCampaignCharacter } from '../domain/factories'
import type { CampaignCharacter } from '../domain/types'
import { useCombatStore } from './useCombatStore'
import { useCampaignStore } from './useCampaignStore'

// The board as a player works it, over the real combat store: a click goes
// through `resolveClick`, the same reading of it the hook dispatches, and a button press is the
// command its hook dispatches. Entropy is the one thing handed in: `roll` is
// the die, and `dice` whoever throws what a command calls for — the screen at
// once, or, at a table that rolls its own (`table`), nobody until a die is
// answered. A panel press is sent as the scene command its hook sends, by
// the GM unless another viewer is named.

const GM: Viewer = { profile: null, role: 'gm', gmMode: true, profiles: [], ownerOf: () => undefined }

const ids = () => {
  let n = 0
  return () => `id-${++n}`
}

export type Harness = ReturnType<typeof openHarness>

export function openHarness(roll: Dice = () => 5, { table = false }: { table?: boolean } = {}) {
  const newId = ids()
  const dice: Throw = table ? toTable(roll) : roll
  useCombatStore.setState(SceneStateSchema.parse({}))
  let brush: TerrainBrush | null = null
  let reposition = false

  const state = (): SceneState => useCombatStore.getState()
  const press = (command: Updater) => useCombatStore.getState().updateCombatState(command)
  const send = (command: SceneCommand, viewer: Viewer = GM) =>
    press((s) => applySceneCommand(s, command, viewer, { thrower: dice, newId }))
  const click = (c: Click) => press(resolveClick(c, { brush, reposition, newId }))

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
    click,
    newId,
    dice,
    roll,
    table,
    view: (): BoardView => getBoardView(state()),
    idOf,
    active,

    // the sidebar: bring a character into the fight, and the board into being
    bring: (...who: (string | CampaignCharacter)[]) => who.forEach((w) => useCampaignStore.getState().loadFighter(typeof w === 'string' ? makeCampaignCharacter({ name: w }) : w)),
    createBoard: (radius: number) => press(createBoard(radius)),
    removeBoard: () => press(removeBoard),
    light: (level: LightLevel) => press(setLight(level)),

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
    startTurn: () => press(startTurn(active()!)),
    declare: (draft: ActionDraft) => send({ kind: 'declare', args: [active()!, draft] }),
    amend: (fields: Partial<ActionDraft>) => send({ kind: 'amend', args: [fields] }),
    commit: () => send({ kind: 'commit', args: [] }),
  } as const
}
