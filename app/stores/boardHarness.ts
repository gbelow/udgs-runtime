import type { Dice } from '../domain/play/dice'
import type { TerrainBrush } from '../domain/types'
import { CombatStateSchema, type ActionDraft, type CombatState, type LightLevel, type Updater } from '../domain/combat/types'
import { getBoardView, type BoardView } from '../domain/combat/projections/boardView'
import { resolveClick, type Click } from '../domain/combat/commands/click'
import { createBoard, setLight } from '../domain/combat/commands/board'
import { amendAction, commitAction, declareAction } from '../domain/combat/commands/action'
import { startTurn } from '../domain/combat/commands/turn'
import { makeCampaignCharacter } from '../domain/factories'
import type { CampaignCharacter } from '../domain/types'
import { useCombatStore } from './useCombatStore'

// The board as a player works it, over the real combat store: a click goes
// through the same `resolveClick` the hook calls and a button press is the
// command its hook dispatches. Entropy is the one thing handed in.

const ids = () => {
  let n = 0
  return () => `id-${++n}`
}

export type Harness = ReturnType<typeof openHarness>

export function openHarness(dice: Dice = () => 5) {
  const newId = ids()
  useCombatStore.setState(CombatStateSchema.parse({}))
  let brush: TerrainBrush | null = null

  const state = (): CombatState => useCombatStore.getState()
  const press = (command: Updater) => useCombatStore.getState().updateCombatState(command)
  const click = (c: Click) => press(resolveClick(c, { brush, newId }))

  const idOf = (name: string): string => {
    const found = Object.values(state().characters).find((c) => c.name === name)
    if (!found) throw new Error(`no character named ${name}`)
    return found.id
  }
  const active = (): string | null => state().activeCharacterId

  return {
    state,
    press,
    click,
    newId,
    dice,
    view: (): BoardView => getBoardView(state()),
    idOf,
    active,

    // the sidebar: bring a character into the fight, and the board into being
    bring: (...who: (string | CampaignCharacter)[]) => who.forEach((w) => useCombatStore.getState().loadCharacter(typeof w === 'string' ? makeCampaignCharacter({ name: w }) : w)),
    createBoard: (radius: number) => press(createBoard(radius)),
    light: (level: LightLevel) => press(setLight(level)),

    // the board
    cell: (q: number, r: number) => click({ on: 'cell', cell: { q, r } }),
    token: (name: string) => click({ on: 'token', id: idOf(name) }),
    floor: (itemId: string) => click({ on: 'floor', itemId }),
    turn: () => click({ on: 'turn' }),
    select: (name: string) => useCombatStore.getState().setActiveCharacter(idOf(name)),
    holdBrush: (b: TerrainBrush | null) => { brush = b },
    // the brush held, a click on each cell `times` over, and put down again
    paint: (b: TerrainBrush, cells: [number, number][], times = 1) => {
      brush = b
      for (const [q, r] of cells) for (let i = 0; i < times; i++) click({ on: 'cell', cell: { q, r } })
      brush = null
    },

    // the action panel and turn controls, which act for the active character
    startTurn: () => press(startTurn(active()!)),
    declare: (draft: ActionDraft) => press(declareAction(active()!, draft, newId)),
    amend: (fields: Partial<ActionDraft>) => press(amendAction(fields)),
    commit: () => press(commitAction(dice, newId)),
  } as const
}
