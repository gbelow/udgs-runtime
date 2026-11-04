import type { ActionDraft, Coord, SceneState, Updater } from '../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import { SPELLS } from '../../spells'
import { ACTION_CATEGORIES, getActionDef, type ActionCategory } from '../rules/actionCatalog'
import { getMovementOptions } from '../rules/move'
import { getFreeAttackOptions } from '../rules/attack'
import { getSpellOptions } from '../rules/cast'
import { sameCell } from '../rules/board/geometry'
import { getOpenAction } from '../rules/log'
import { getAvailableActions } from '../rules/options'
import { getFightName } from '../rules/fighters'
import { getActionName, getOptionLabel } from '../projections/labels'
import { amendAction, declareAction, declareReaction, passReaction, setTarget } from './action'
import { readPick } from './board'

// What a click on the board offers: the actions the selected character could
// declare against what was clicked, or the answers a clicked character has to
// the action in play. An entry is offered only if pressing it leaves the
// action aimed at what was clicked, so the menu cannot offer what the panel
// would refuse.

export type MenuAim =
  | { on: 'token', id: string }
  | { on: 'floor', itemId: string }
  | { on: 'cell', cell: Coord, height?: number | null }

// What pressing an entry does: declare an action with the fields the panel
// would fill in, aimed where the click was, or answer the action in play.
export type MenuPress =
  | { kind: 'declare', actorId: string, draft: ActionDraft, fields: Partial<ActionDraft>, aim: MenuAim }
  | { kind: 'answer', reactorId: string, draft: ActionDraft }
  | { kind: 'pass', reactorId: string }

export type MenuEntry = { label: string, category: ActionCategory | 'answer', cost: ActionCost | null, press: MenuPress }

// `select` is the clicked character, whom the screen may pick instead.
export type ClickMenu = { title: string, select: string | null, entries: MenuEntry[] }

export function pressMenu(press: MenuPress, newId: () => string): Updater {
  return (state) => {
    switch (press.kind) {
      case 'answer': return declareReaction(press.reactorId, press.draft, newId)(state)
      case 'pass': return passReaction(press.reactorId)(state)
      case 'declare': {
        const declared = declareAction(press.actorId, press.draft, newId)(state)
        if (declared === state) return state
        const filled = Object.keys(press.fields).length > 0 ? amendAction(press.fields)(declared) : declared
        return aim(press.aim, newId)(filled)
      }
    }
  }
}

function aim(at: MenuAim, newId: () => string): Updater {
  return (state) => {
    if (at.on === 'cell') return readPick(state, at.cell, newId, at.height)?.apply(state) ?? state
    return setTarget(at.on === 'token' ? at.id : at.itemId)(state)
  }
}

// Whether the action now open is aimed at what was clicked.
export function isAimed(state: SceneState, at: MenuAim): boolean {
  const open = getOpenAction(state)
  if (!open || open.step !== 'define') return false
  switch (at.on) {
    case 'token': return 'targetId' in open && open.targetId === at.id
    case 'floor': return 'object' in open && open.object === at.itemId
    case 'cell': return open.kind === 'move' && open.path.length > 0 && sameCell(open.path[open.path.length - 1], at.cell)
  }
}

// What the selected character may declare against a click, one entry for each
// way of declaring it (each weapon row, each spell), or what the clicked
// character may answer the open action with. Null when nothing is offered.
export function getClickMenu(state: SceneState, at: MenuAim, selected: string | null): ClickMenu | null {
  const open = getOpenAction(state)
  if (!open) return selected ? getOwnMenu(state, at, selected) : null
  return open.step === 'react' && at.on === 'token' ? getAnswerMenu(state, at.id) : null
}

function getOwnMenu(state: SceneState, at: MenuAim, selected: string): ClickMenu | null {
  const c = state.characters[selected]
  if (!c) return null
  const entries = getAvailableActions(state, selected)
    .filter((o) => o.available && o.reactionTo === null && (at.on === 'cell') === (o.draft.kind === 'move'))
    .flatMap((o): MenuEntry[] => {
      const category = getActionDef(o.draft.kind).category ?? 'tactical'
      const entry = (label: string, cost: ActionCost | null, fields: Partial<ActionDraft> = {}): MenuEntry => ({ label, category, cost, press: { kind: 'declare', actorId: selected, draft: o.draft, fields, aim: at } })
      if (o.draft.kind === 'strike' || o.draft.kind === 'shoot') {
        return getFreeAttackOptions(state, c, o.draft.kind).map((row) => entry(`${row.weapon} ${row.attack} ${row.variant}`.replace(/\s+/g, ' ').trim(), { AP: row.AP, STA: row.STA }, { weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }))
      }
      if (o.draft.kind === 'cast') {
        return getSpellOptions(state, c).filter((s) => s.targeted && (s.castable || s.quickenable))
          .map((s) => entry(SPELLS[s.key].name, s.cost, { key: s.key, quicken: !s.castable }))
      }
      // a move is offered once for each way of moving that reaches the cell: which one is the player's to say
      if (o.draft.kind === 'move') {
        return getMovementOptions(state, c).filter((m) => m.available)
          .map((m) => entry(`${m.kind} here`, m.block, { movement: m.kind, path: [], dive: 0, mode: 'normal', leap: false, recipe: null, metres: null, ledge: null }))
      }
      return [entry(getActionName(o.draft), o.cost)]
    })
    .filter((e) => e.press.kind === 'declare' && isAimed(pressMenu(e.press, () => 'probe')(state), at))
    .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category))
  // a character is always offered for picking, even with nothing to do against them
  if (entries.length === 0 && at.on !== 'token') return null
  return { title: at.on === 'token' ? getFightName(state, at.id) : at.on === 'cell' ? 'here' : 'item', select: at.on === 'token' ? at.id : null, entries }
}

const categoryOrder = (category: MenuEntry['category']): number => category === 'answer' ? ACTION_CATEGORIES.length : ACTION_CATEGORIES.indexOf(category)

function getAnswerMenu(state: SceneState, id: string): ClickMenu | null {
  const answers = getAvailableActions(state, id).filter((o) => o.available && o.reactionTo !== null)
  if (answers.length === 0) return null
  const entries: MenuEntry[] = [
    ...answers.map((o): MenuEntry => ({ label: getOptionLabel(state, id, o), category: 'answer', cost: o.cost, press: { kind: 'answer', reactorId: id, draft: o.draft } })),
    { label: 'nothing', category: 'answer', cost: null, press: { kind: 'pass', reactorId: id } },
  ]
  return { title: `${getFightName(state, id)} answers`, select: id, entries }
}
