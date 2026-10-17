import { isCombatStarted } from '../rules/started'
import type { TerrainBrush } from '../../types'
import type { Actor } from '../../profiles'
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

// What the click does not say for itself: the brush in hand, whether the
// GM's repositioning tool is, and whom the screen has picked, which only the
// screen knows, and where the ids of whatever it declares come from.
export type ClickContext = { brush: TerrainBrush | null, reposition: boolean, selected: string | null, newId: () => string }

// What a click means: whom it acts for and what it does to the fight, or the
// character it picks on the screen it was made on, which the fight never sees.
export type ClickReading = { actor: Actor, apply: Updater } | { select: string }

// What a click means in the state it lands on: painting if a brush is in
// hand, a path edit while a move is being declared, the landing of an evasive
// jump while one may be declared, where an explosion is aimed while one waits
// to be, otherwise the selected character put down by hand: anywhere and
// turned as their player likes until the fight starts, then only the first
// time they are, or anywhere with the repositioning tool, which alone turns
// a character outside a move once the fight is under way. A token is aimed at while the open action waits
// for a target and is picked otherwise; an item on the
// floor is aimed at when the open strike could hit it, else picked up when
// the picker could take it. A click that means nothing leaves the state as
// it was.
export function readClick(state: SceneState, click: Click, ctx: ClickContext): ClickReading {
  const open = getOpenAction(state)
  const actor = open ? { id: open.actorId } : null
  switch (click.on) {
    case 'cell': return readCell(state, click.cell, ctx)
    case 'token': return getDeclaredTargets(state, open).includes(click.id) ? { actor, apply: setTarget(click.id) } : { select: click.id }
    case 'floor': {
      if (getDeclaredFloorTargets(state, open).some((f) => f.item.id === click.itemId)) return { actor, apply: setTarget(click.itemId) }
      const picker = getFloorPicker(state, ctx.selected)
      return picker?.itemIds.includes(click.itemId) ? { actor: { id: picker.picker }, apply: pickFloorItem(picker.picker, click.itemId, ctx.newId) } : NOTHING
    }
    case 'turn': {
      if (getBoardMode(state) === 'path') return { actor, apply: turnMove() }
      const id = ctx.selected
      if (!id) return NOTHING
      if (ctx.reposition) return { actor: 'gmTool', apply: turnCharacter(id) }
      return isCombatStarted(state) ? NOTHING : { actor: { id }, apply: turnCharacter(id) }
    }
  }
}

const NOTHING = { actor: null, apply: (s: SceneState) => s }

function readCell(state: SceneState, cell: Coord, ctx: ClickContext): ClickReading {
  if (ctx.brush) return { actor: 'gmTool', apply: paintTerrain(cell, ctx.brush) }
  const mode = getBoardMode(state)
  if (mode === 'path' || mode === 'jump' || mode === 'aim') {
    const pick = readPick(state, cell, ctx.newId)
    return pick ? { actor: { id: pick.actor }, apply: pick.apply } : NOTHING
  }
  if (mode === 'idle' && ctx.selected) {
    return ctx.reposition ? { actor: 'gmTool', apply: repositionCharacter(ctx.selected, cell) } : { actor: { id: ctx.selected }, apply: placeCharacter(ctx.selected, cell) }
  }
  return NOTHING
}
