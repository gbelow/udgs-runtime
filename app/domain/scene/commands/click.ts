import { isCombatStarted } from '../rules/started'
import type { TerrainBrush } from '../../types'
import type { SceneState, Coord, Updater } from '../types'
import { getDeclaredFloorTargets, getDeclaredTargets } from '../rules/action'
import { getBoardMode, getFloorPicker } from '../rules/board/boardMode'
import { getOpenAction } from '../rules/log'
import { setTarget } from './action'
import { paintTerrain, placeCharacter, readPick, repositionCharacter, turnCharacter, turnMove } from './board'
import { pickFloorItem } from './floor'

// What the board is clicked on.
export type Click =
  | { on: 'cell', cell: Coord }
  | { on: 'token', id: string }
  | { on: 'floor', itemId: string }
  | { on: 'turn' }

// What the click does not say for itself: the brush in hand and whether the
// GM's repositioning tool is, which only the screen knows, and where the ids
// of whatever it declares come from.
export type ClickContext = { brush: TerrainBrush | null, reposition: boolean, newId: () => string }

// Whom a click acts for, so that the screen lets it be made only by whoever
// plays them: a character by id, the GM for the table's own tools (the
// brush, the repositioning tool), or nobody for a click that only picks
// whom to look at or does nothing.
export type ClickActor = { id: string } | 'gm' | null

// What a click means in the state it lands on: painting if a brush is in
// hand, a path edit while a move is being declared, the landing of an evasive
// jump while one may be declared, where an explosion is aimed while one waits
// to be, otherwise the active character put down by hand: anywhere and
// turned as their player likes until the fight starts, then only the first
// time they are, or anywhere with the repositioning tool, which alone turns
// a character outside a move once the fight is under way. A token is aimed at while the open action waits
// for a target and becomes the active character otherwise; an item on the
// floor is aimed at when the open strike could hit it, else picked up when
// the picker could take it. A click that means nothing leaves the state as
// it was.
export function resolveClick(click: Click, ctx: ClickContext): Updater {
  return (state) => readClick(state, click, ctx).apply(state)
}

// The same click, with whom it acts for.
export function readClick(state: SceneState, click: Click, ctx: ClickContext): { actor: ClickActor, apply: Updater } {
  const open = getOpenAction(state)
  const actor = open ? { id: open.actorId } : null
  switch (click.on) {
    case 'cell': return readCell(state, click.cell, ctx)
    case 'token': return getDeclaredTargets(state, open).includes(click.id) ? { actor, apply: setTarget(click.id) } : { actor: null, apply: selectCharacter(click.id) }
    case 'floor': {
      if (getDeclaredFloorTargets(state, open).some((f) => f.item.id === click.itemId)) return { actor, apply: setTarget(click.itemId) }
      const picker = getFloorPicker(state)
      return picker?.itemIds.includes(click.itemId) ? { actor: { id: picker.picker }, apply: pickFloorItem(picker.picker, click.itemId, ctx.newId) } : NOTHING
    }
    case 'turn': {
      if (getBoardMode(state) === 'path') return { actor, apply: turnMove() }
      const id = state.activeCharacterId
      if (!id) return NOTHING
      if (ctx.reposition) return { actor: 'gm', apply: turnCharacter(id) }
      return isCombatStarted(state) ? NOTHING : { actor: { id }, apply: turnCharacter(id) }
    }
  }
}

const NOTHING = { actor: null, apply: (s: SceneState) => s }

function readCell(state: SceneState, cell: Coord, ctx: ClickContext): { actor: ClickActor, apply: Updater } {
  if (ctx.brush) return { actor: 'gm', apply: paintTerrain(cell, ctx.brush) }
  const mode = getBoardMode(state)
  if (mode === 'path' || mode === 'jump' || mode === 'aim') {
    const pick = readPick(state, cell, ctx.newId)
    return pick ? { actor: { id: pick.actor }, apply: pick.apply } : NOTHING
  }
  if (mode === 'idle' && state.activeCharacterId) {
    return ctx.reposition ? { actor: 'gm', apply: repositionCharacter(state.activeCharacterId, cell) } : { actor: { id: state.activeCharacterId }, apply: placeCharacter(state.activeCharacterId, cell) }
  }
  return NOTHING
}

export function selectCharacter(id: string): Updater {
  return (state) => ({ ...state, activeCharacterId: id })
}
