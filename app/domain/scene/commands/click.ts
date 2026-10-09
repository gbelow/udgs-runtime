import type { TerrainBrush } from '../../types'
import type { SceneState, Coord, Updater } from '../types'
import { getDeclaredFloorTargets, getDeclaredTargets } from '../rules/action'
import { getBoardMode, getFloorPicker } from '../rules/board/boardMode'
import { getOpenAction } from '../rules/log'
import { setTarget } from './action'
import { paintTerrain, pickCell, placeCharacter, turnCharacter, turnMove } from './board'
import { pickFloorItem } from './floor'

// What the board is clicked on.
export type Click =
  | { on: 'cell', cell: Coord }
  | { on: 'token', id: string }
  | { on: 'floor', itemId: string }
  | { on: 'turn' }

// What the click does not say for itself: the brush in hand, which only the
// screen knows, and where the ids of whatever it declares come from.
export type ClickContext = { brush: TerrainBrush | null, newId: () => string }

// What a click means in the state it lands on: painting if a brush is in
// hand, a path edit while a move is being declared, the landing of an evasive
// jump while one may be declared, where an explosion is aimed while one waits
// to be, otherwise a placement of the active character by hand. A token is
// aimed at while the open action waits for a target and becomes the active
// character otherwise; an item on the floor is aimed at when the open strike
// could hit it, else picked up when the picker could take it. A click that
// means nothing leaves the state as it was.
export function resolveClick(click: Click, ctx: ClickContext): Updater {
  return (state) => {
    switch (click.on) {
      case 'cell': return clickCell(state, click.cell, ctx)(state)
      case 'token': return (getDeclaredTargets(state, getOpenAction(state)).includes(click.id) ? setTarget(click.id) : selectCharacter(click.id))(state)
      case 'floor': {
        if (getDeclaredFloorTargets(state, getOpenAction(state)).some((f) => f.item.id === click.itemId)) return setTarget(click.itemId)(state)
        const picker = getFloorPicker(state)
        return picker?.itemIds.includes(click.itemId) ? pickFloorItem(picker.picker, click.itemId, ctx.newId)(state) : state
      }
      case 'turn': {
        if (getBoardMode(state) === 'path') return turnMove()(state)
        return state.activeCharacterId ? turnCharacter(state.activeCharacterId)(state) : state
      }
    }
  }
}

function clickCell(state: SceneState, cell: Coord, ctx: ClickContext): Updater {
  if (ctx.brush) return paintTerrain(cell, ctx.brush)
  const mode = getBoardMode(state)
  if (mode === 'path' || mode === 'jump' || mode === 'aim') return pickCell(cell, ctx.newId)
  if (mode === 'idle' && state.activeCharacterId) return placeCharacter(state.activeCharacterId, cell)
  return (s) => s
}

export function selectCharacter(id: string): Updater {
  return (state) => ({ ...state, activeCharacterId: id })
}
