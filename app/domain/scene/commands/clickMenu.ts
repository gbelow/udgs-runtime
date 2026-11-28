import type { ActionDraft, Coord, SceneState, SeenScene, Updater } from '../types'
import type { Term } from '../../character/rules/terms'
import type { CampaignCharacter, SurgeKind } from '../../types'
import type { Throw } from '../../play/calls'
import type { ActionCost } from '../../character/rules/actionCosts'
import type { Damage } from '../../character/rules/gear'
import { SPELLS } from '../../spells'
import { getActionDef, type ActionCategory } from '../rules/actionCatalog'
import { getMovementOptions } from '../rules/move'
import { getFreeAttackOptions } from '../rules/attack'
import { getNeededExtend, getSpellOptions } from '../rules/cast'
import { canTreadToShoot } from '../rules/steadyArms'
import { isVariantOpenOn } from '../rules/strikeDeclaration'
import { getDraftTerms, getModifierToggles } from '../rules/modifiers'
import { sameCell } from '../rules/board/geometry'
import { getOpenAction } from '../rules/log'
import { getDeclaredHiddenTargets, getOwnCost, getReleaseBar, needsTarget } from '../rules/action'
import { getAnswerWays, getAvailableActions, type ActionOption } from '../rules/options'
import { getGivesLine, getSurgeFacts } from '../../character/lenses/surge'
import { getFightName } from '../rules/fighters'
import { getStartTurnBar, getTurnHolder } from '../rules/turn'
import { getFollowBar } from '../rules/follow'
import { getMustStart } from '../projections/turn'
import { getOpenChoices, type ChoicePart } from '../projections/choices'
import { getActionName, getDraftLabel, getPassLabel, getRowHint } from '../projections/labels'
import { getHeldOf } from '../rules/hold'
import type { SceneCommand } from './registry'
import { amendAction, commitAction, declareAction, declareReaction, passReaction, setTarget } from './action'
import { readPick } from './board'
import { surge } from './turn'
import { follow } from './follow'
import { ACTION_CATEGORIES } from '../../lists'
import { perState } from '../../perState'

// What a click on the board offers: everything the selected character could
// declare, aimed at what was clicked where it can be, or the answers a clicked
// character has to the action in play. What the panel shows closed is shown
// closed here, with why; an entry that is open is one the panel would take.

export type MenuAim =
  | { on: 'token', id: string }
  | { on: 'floor', itemId: string }
  | { on: 'cell', cell: Coord, height?: number | null }

// What pressing an entry does: declare an action with the fields the panel
// would fill in, aimed where the click was if it can be, on a surge made first
// where it needs one, and committed at once where nothing is left to say
// (`commit`); or answer the action in play; or mark whom to follow, or take
// the mark back (`targetId` null).
export type MenuPress =
  | { kind: 'declare', actorId: string, draft: ActionDraft, fields: Partial<ActionDraft>, aim: MenuAim | null, surge?: SurgeKind | null, commit?: boolean }
  | { kind: 'answer', reactorId: string, draft: ActionDraft, surge: SurgeKind | null }
  | { kind: 'pass', reactorId: string }
  | { kind: 'follow', actorId: string, targetId: string | null }

// Whom the press acts for.
export const getPressActor = (press: MenuPress): string => (press.kind === 'declare' || press.kind === 'follow' ? press.actorId : press.reactorId)

// `bar`, why it cannot be pressed now; `surge`, the surge it is made on.
// `damage`, the blow an attack row lands; `note`, what an answer is made
// with: the surge, and what it gives.
// `terms`, what the action as the entry declares it puts on its own test.
export type MenuEntry = { label: string, category: ActionCategory | 'answer', cost: ActionCost | null, surge: SurgeKind | null, bar: string | null, press: MenuPress, damage?: Damage, note?: string, hint?: string, terms?: Term[] }

// The entries of one category, and how many of them may be pressed now.
export type MenuGroup = { category: ActionCategory | 'answer', entries: MenuEntry[], open: number }

// `select` is the clicked character, whom the screen may pick instead;
// `actor`, whose entries they are; `turn`, said when they must start a turn
// before they act, and why they cannot now; `groups`, the entries under the
// heading of their category, every category shown; `answering`, the open
// action its answers are to; `at`, what was clicked to open it.
// `held`, the action its character holds over to the next round: released
// now where they may, or dropped.
export type ClickMenu = { title: string, select: string | null, actor: string, turn: { note: string, bar: string | null } | null, entries: MenuEntry[], groups: MenuGroup[], answering?: string, at: MenuAim, held?: { title: string, release: SceneCommand, bar: string | null, drop: SceneCommand } }

function groupEntries(entries: readonly MenuEntry[]): MenuGroup[] {
  const categories = entries.some((e) => e.category === 'answer') ? ['answer' as const] : ACTION_CATEGORIES
  return categories.map((category) => {
    const shown = entries.filter((e) => e.category === category)
    return { category, entries: shown, open: shown.filter((e) => e.bar === null).length }
  })
}

// `fill`: whether what there is only one of is filled in, which the menu's
// own probes of an entry leave out.
export function pressMenu(press: MenuPress, newId: () => string, thrown: Throw, fill = true): Updater {
  return (state) => {
    switch (press.kind) {
      case 'answer': return declareReaction(press.reactorId, press.draft, newId, press.surge)(state)
      case 'pass': return passReaction(press.reactorId)(state)
      case 'follow': return follow(press.actorId, press.targetId)(state)
      case 'declare': {
        const ready = press.surge ? surge(press.actorId, press.surge)(state) : state
        const declared = declareAction(press.actorId, press.draft, newId)(ready)
        if (declared === ready) return state
        // a recipe is offered on the row it goes with, so the row first
        const { recipe, ...fields } = press.fields
        const rowed = Object.keys(fields).length > 0 ? amendAction(fields)(declared) : declared
        const filled = recipe !== undefined ? amendAction({ recipe })(rowed) : rowed
        const pointed = press.aim ? aim(press.aim, newId)(filled) : filled
        const aimed = fill ? fillLone(pointed, press.actorId) : pointed
        return press.commit ? commitAction(thrown, newId)(aimed) : aimed
      }
    }
  }
}

// What an action declared from the menu is aimed at, or carries, where there
// is only one thing it could be: the one target it may be aimed at, the one
// item, piece of gear, ammo or charge it may take. Nothing is filled in that
// is chosen already.
export const LONE_PARTS: readonly ChoicePart[] = ['target', 'item', 'gear', 'chargeInto', 'ammo', 'container', 'charge']

function fillLone(state: SceneState, actorId: string): SceneState {
  const choices = getOpenChoices(state).filter((c) => c.actorId === actorId && LONE_PARTS.includes(c.part))
  return LONE_PARTS.reduce((s, part) => {
    const of = choices.filter((c) => c.part === part)
    if (of.length !== 1 || of[0].chosen) return s
    const { command } = of[0]
    if (command.kind === 'amend') return amendAction(command.args[0])(s)
    if (command.kind === 'target') return setTarget(command.args[0])(s)
    return s
  }, state)
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

// What the selected character may declare, one entry for each way of declaring
// it (each weapon row, each spell, each way of moving), aimed at the click, or
// what the clicked character may answer the open action with, each answer once:
// another surge to make it on is picked in the panel. Null when the click is
// not theirs to act on: nobody placed is selected, or someone answers nothing.
// The menu the character holding the turn opens with no click, aimed at
// nothing, as a click on themself opens it; none for anyone else, nor while
// an action is open.
export function getTurnMenu(state: SceneState, selected: string | null): ClickMenu | null {
  if (!selected || getOpenAction(state) || getTurnHolder(state) !== selected) return null
  return getOwnMenu(state, { on: 'token', id: selected }, selected)
}

// The character the popover is about: the one a menu was opened on, other
// than whoever it is for, or the one the open action is aimed at; none for
// a menu aimed at a cell, an item or the actor themself.
export function getPopoverAim(state: SceneState, menu: ClickMenu | null): string | null {
  if (menu) return menu.at.on === 'token' && menu.at.id !== menu.actor ? menu.at.id : null
  const open = getOpenAction(state)
  return open && 'targetId' in open && open.targetId && state.characters[open.targetId] ? open.targetId : null
}

// What the open action is walked again from once its walk was put away: a
// menu of its actor's aimed at its target, or at nothing, with no entries of
// its own; none while no action is open.
export function getResumed(state: SceneState): { from: ClickMenu, actionId: string } | null {
  const open = getOpenAction(state)
  if (!open) return null
  const targetId = 'targetId' in open && open.targetId && state.characters[open.targetId] ? open.targetId : null
  const at: MenuAim = { on: 'token', id: targetId ?? open.actorId }
  return { from: { title: getFightName(state, at.id), select: at.id, actor: open.actorId, turn: null, entries: [], groups: [], at }, actionId: open.id }
}

export function getClickMenu(state: SceneState, at: MenuAim, selected: string | null): ClickMenu | null {
  const open = getOpenAction(state)
  if (!open) return selected ? getOwnMenu(state, at, selected) : null
  return open.step === 'react' && at.on === 'token' ? getAnswerMenu(state, at.id) : null
}

function getOwnMenu(state: SceneState, at: MenuAim, selected: string): ClickMenu | null {
  const c = state.characters[selected]
  if (!c || (at.on !== 'token' && !state.board?.placements[selected])) return null
  const note = getMustStart(state, selected)
  // a click on the character themself aims at nothing: whatever needs a target is aimed in the walk
  const own = at.on === 'token' && at.id === c.id
  const entries = [...getOwnEntries(state, own ? null : at, c), ...getFollowEntry(state, at, c)]
  const held = getHeldOf(state, c.id)
  return {
    ...(held ? { held: { title: getActionName(held), release: { kind: 'releaseHeld', args: [c.id] }, bar: getReleaseBar(state, held), drop: { kind: 'dropHeld', args: [c.id] } } } : {}),
    title: at.on === 'token' ? getFightName(state, at.id) : at.on === 'cell' ? 'here' : 'item',
    select: at.on === 'token' ? at.id : null,
    actor: selected,
    turn: note ? { note, bar: getStartTurnBar(state, selected) } : null,
    entries,
    groups: groupEntries(entries),
    at,
  }
}

// combat.tex "Follow": the clicked one marked as whom the character follows
// this round, for free, or the mark taken back from them; closed with why.
function getFollowEntry(state: SceneState, at: MenuAim, c: CampaignCharacter): MenuEntry[] {
  if (at.on !== 'token' || at.id === c.id || !state.characters[at.id]) return []
  const marked = state.following[c.id] === at.id
  const name = getFightName(state, at.id)
  return [{ label: marked ? `stop following ${name}` : `follow ${name}`, category: 'tactical', cost: null, surge: null, bar: marked ? null : getFollowBar(state, c.id, at.id), press: { kind: 'follow', actorId: c.id, targetId: marked ? null : at.id } }]
}

function getOwnEntries(state: SceneState, at: MenuAim | null, c: CampaignCharacter): MenuEntry[] {
  return getAvailableActions(state, c.id).filter((o) => o.reactionTo === null).flatMap((o) => getEntries(state, at, c, o))
}

// What the character may declare with nothing clicked, which the action panel
// lists: the same entries the board's menu offers, aimed at nothing, under the
// categories that have any; none while an action is open.
const actionMenus = perState((_: SceneState) => new Map<string, MenuGroup[]>())

export function getActionMenu(state: SceneState, id: string | null): MenuGroup[] {
  const c = id ? state.characters[id] : undefined
  if (!c || getOpenAction(state)) return []
  const known = actionMenus(state)
  const groups = known.get(c.id) ?? groupEntries(getOwnEntries(state, null, c)).filter((g) => g.entries.length > 0)
  known.set(c.id, groups)
  return groups
}

export const getActionMenuDigest = perState((state: SeenScene) => JSON.stringify(getActionMenu(state, state.activeCharacterId)))

// The entries of one of the character's own options: one for each thing it can
// be declared with, read on the fight with its surge made where it needs one,
// or the option itself, closed, where there is none.
function getEntries(state: SceneState, at: MenuAim | null, c: CampaignCharacter, o: ActionOption): MenuEntry[] {
  const { draft } = o
  const category = getActionDef(draft.kind).category ?? 'tactical'
  const needs = o.available ? null : o.surge
  const ready = needs ? surge(c.id, needs)(state) : state
  const own = ready.characters[c.id]
  const bar = o.available || (needs && ready !== state) ? null : o.reason ?? 'closed'
  const entry = (label: string, cost: ActionCost | null, fields: Partial<ActionDraft> = {}, closed: string | null = null, made: SurgeKind | null = needs): MenuEntry =>
    aimed(state, withTerms(state, c.id, { ...draft, ...fields } as ActionDraft, null, { label, category, cost, surge: made, bar: bar ?? closed, press: { kind: 'declare', actorId: c.id, draft, fields, aim: at, surge: made } }))
  switch (draft.kind) {
    case 'strike':
    case 'shoot': {
      // declared on its own, nobody's step draws it: a braced row waits for one
      const rows = getFreeAttackOptions(ready, own, draft.kind).flatMap((row) => withMoves(state, hinted(getRowHint(own, row.weaponKey, row.attack), damaged(row, entry(`${row.weapon} ${row.attack} ${row.variant}`.replace(/\s+/g, ' ').trim(), { AP: row.AP, STA: row.STA }, { weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, isVariantOpenOn(null, row.variant) ? null : 'only drawn by a step towards the weapon')))))
      return rows.length > 0 ? rows : [entry(getDraftLabel(state, c.id, o), null)]
    }
    case 'cast': {
      const focused = surge(c.id, 'focus')(state)
      const withFocus = focused === state ? [] : getSpellOptions(focused, focused.characters[c.id])
      const spells = getSpellOptions(state, c).flatMap((s): MenuEntry[] => {
        const { name } = SPELLS[s.key]
        const cast = (label: string, quicken: boolean, closed: string | null, made: SurgeKind | null) => {
          const plain = entry(label, s.cost, { key: s.key, quicken }, closed, made)
          const extend = closed === null ? getExtendTo(state, plain) : 0
          return extend > 0 ? entry(`${label}, extended ×${extend}`, s.cost, { key: s.key, quicken, extend }, closed, made) : plain
        }
        const onFocus = withFocus.find((f) => f.key === s.key)?.castable ?? false
        return [
          ...(s.castable ? [cast(name, false, null, null)] : onFocus ? [cast(name, false, null, 'focus')] : []),
          ...(s.quickenable ? [cast(`${name}, quickened`, true, null, null)] : []),
          ...(!s.castable && !onFocus && !s.quickenable ? [cast(name, false, s.reason, null)] : []),
        ]
      })
      return spells.length > 0 ? spells : [entry(getDraftLabel(state, c.id, o), null)]
    }
    // a move is offered once for each way of moving: which one is the player's to say
    case 'move': {
      const ways = getMovementOptions(ready, own).map((m) => entry(at?.on === 'cell' ? `${m.kind} here` : m.kind, m.block, { movement: m.kind, path: [], dive: 0, mode: 'normal', leap: false, recipe: null, metres: null, ledge: null }, m.available ? null : m.reason ?? 'closed'))
      return ways.length > 0 ? ways : [entry(getDraftLabel(state, c.id, o), null)]
    }
    default:
      return [entry(getDraftLabel(state, c.id, o), o.cost)]
  }
}

function probe(state: SceneState, press: MenuPress): SceneState {
  return pressMenu(press, () => 'probe', () => 5, false)(state)
}

// An attack out of reach of the clicked one, and after it the same attack
// with each move it may carry that brings them in reach: a jump, aimed at them
// from where it lands (abilities.tex "Lunge"), or a tread, drawn before they
// are aimed at (abilities.tex "Steady Arms").
// An entry with what its action puts on its own test, where it puts anything.
function withTerms(state: SceneState, actorId: string, draft: ActionDraft, reactionTo: string | null, entry: MenuEntry): MenuEntry {
  const { terms: _, ...rest } = entry
  const terms = getDraftTerms(state, actorId, draft, reactionTo)
  return terms.length > 0 ? { ...rest, terms } : rest
}

// An attack row's entry, with the blow it lands.
const damaged = ({ blunt, cut }: Damage, entry: MenuEntry): MenuEntry => ({ ...entry, damage: { blunt, cut } })
const hinted = (hint: string | undefined, entry: MenuEntry): MenuEntry => (hint ? { ...entry, hint } : entry)

function withMoves(state: SceneState, plain: MenuEntry): MenuEntry[] {
  const { press } = plain
  if (plain.bar === null || press.kind !== 'declare' || press.aim?.on !== 'token') return [plain]
  const at = press.aim
  const declared = probe(state, { ...press, aim: null })
  const open = getOpenAction(declared)
  if (declared === state || !open) return [plain]
  const moves = getModifierToggles(declared, open).filter((t) => t.allowed && t.press.recipe).flatMap((t): MenuEntry[] => {
    const carrying = { ...press, fields: { ...press.fields, ...t.press } as Partial<ActionDraft> }
    const unaimed = probe(state, { ...carrying, aim: null })
    const attack = getOpenAction(unaimed)
    if (!attack) return []
    const entry: MenuEntry = withTerms(state, press.actorId, { ...press.draft, ...carrying.fields } as ActionDraft, null, { ...plain, label: `${plain.label} (${t.label})`, cost: getOwnCost(unaimed, attack) ?? plain.cost, bar: null, press: carrying })
    if (isAimed(probe(state, carrying), at)) return [entry]
    return attack.kind === 'shoot' && canTreadToShoot(unaimed, attack, at.id) ? [{ ...entry, press: { ...carrying, aim: null } }] : []
  })
  return [plain, ...moves]
}

// How many times the cast that cannot be aimed at the clicked one has to be
// extended to reach them (spells.tex "Extend Spell"); none where that is not
// what it lacks.
function getExtendTo(state: SceneState, { bar, press }: MenuEntry): number {
  if (bar === null || press.kind !== 'declare' || press.aim?.on !== 'token') return 0
  const declared = probe(state, { ...press, aim: null })
  const open = getOpenAction(declared)
  const extend = declared !== state && open?.kind === 'cast' ? getNeededExtend(declared, open, press.aim.id) ?? 0 : 0
  return extend > 0 && isAimed(probe(state, { ...press, fields: { ...press.fields, extend } as Partial<ActionDraft> }), press.aim) ? extend : 0
}

// What the click would aim: an action that needs a target is closed, with
// why, where the clicked one cannot be it, as is a move that does not reach the
// cell; one aimed at something else, or at nothing, is declared as the panel
// declares it.
function aimed(state: SceneState, entry: MenuEntry): MenuEntry {
  const { press } = entry
  if (entry.bar !== null || press.kind !== 'declare' || !press.aim) return entry
  if (isAimed(probe(state, press), press.aim)) return entry
  if (press.draft.kind === 'move' && press.aim.on === 'cell') return { ...entry, bar: 'out of reach' }
  const unaimed = { ...press, aim: null }
  const declared = probe(state, unaimed)
  const open = getOpenAction(declared)
  if (declared === state || !open) return { ...entry, bar: 'cannot be declared now' }
  if (press.aim.on === 'token' && needsTarget(declared, open)) return { ...entry, bar: getDeclaredHiddenTargets(declared, open).includes(press.aim.id) ? 'not detected' : 'cannot be aimed at them' }
  return { ...entry, press: unaimed }
}

// Each answer is offered every way it may be made, with no surge or on one,
// as an attack is offered with each row, saying what the surge gives; the
// surge the character is on already says so too.
function getAnswerMenu(state: SceneState, id: string): ClickMenu | null {
  const c = state.characters[id]
  const options = getAvailableActions(state, id)
  const answers = getAnswerWays(options).flatMap((a) => a.ways).filter((o) => o.available && o.reactionTo !== null)
  if (!c || answers.length === 0) return null
  const gives = (kind: SurgeKind) => getGivesLine(getSurgeFacts(c, kind))
  const entries: MenuEntry[] = [
    ...answers.map((o): MenuEntry => {
      const label = getDraftLabel(state, id, o)
      // a recipe named for its surge says it already
      const surge = o.surge && !label.includes(`${o.surge} surge`) ? o.surge : null
      const on = o.surge ?? c.usedSurge
      const note = on ? `${on} surge${gives(on) ? ` ${gives(on)}` : ''}` : undefined
      return withTerms(state, id, o.draft, o.reactionTo, { label, category: 'answer', cost: o.cost, surge, bar: null, press: { kind: 'answer', reactorId: id, draft: o.draft, surge: o.surge }, ...(note ? { note } : {}) })
    }),
    { label: getPassLabel(state, id, options).label, category: 'answer', cost: null, surge: null, bar: null, press: { kind: 'pass', reactorId: id } },
  ]
  return { title: `${getFightName(state, id)} reacts`, select: id, actor: id, turn: null, entries, groups: groupEntries(entries), answering: getOpenAction(state)?.id, at: { on: 'token', id } }
}
