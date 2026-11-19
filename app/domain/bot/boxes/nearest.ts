import type { CampaignCharacter, Coord, MovementKind } from '../../types'
import type { MoveAction, SceneState } from '../../scene/types'
import { toUpdater, type CommandContext, type SceneCommand } from '../../scene/commands/registry'
import { getOpenAction } from '../../scene/rules/log'
import { isAttackAction } from '../../scene/rules/actionCatalog'
import { getFreeAttackOptions, hasUnfocusedRow } from '../../scene/rules/attack'
import { isCombatStarted } from '../../scene/rules/started'
import { getMovementOptions } from '../../scene/rules/move'
import { getReachableCells } from '../../scene/rules/board/reach'
import { isClearWalk } from '../reach'
import { distance } from '../../scene/rules/board/geometry'
import { getEndTurnBar, getTurnHolder, hasAgreedToEnd } from '../../scene/rules/turn'
import { getRoundPhase } from '../../scene/rules/roundChange'
import type { OpenButton } from '../../scene/projections/buttons'
import { declare, settle, type Intent } from '../declare'
import { getSides } from '../table'
import type { Box, Decision, SeatInput } from '../decision'
import type { Wait } from '../table'
import { getRestChoice, REST_TUNING, type RestTuning } from '../rest'
import { getBestSpendPicks } from '../predict'

// A baseline to measure other boxes against: each character walks to the foe
// nearest them and attacks it with the first weapon that reaches, and does
// nothing else of its own will. It answers nothing (it passes), holds on to
// what it concentrates on, makes the morale test it owes with its first mode,
// is taken for a coward rather than do a limit stress action it owes, makes a
// surge the table holds it to, and
// lands what it rolled with a hit's overflow spent as `getBestSpend` spends it. A turn is started only when
// there is an attack or a step closer to make in it; otherwise the character
// agrees to end the round.

// what the box tries on its own copy of the fight; nothing it presses there is sent
const TRIAL: CommandContext = { thrower: () => 0, newId: () => 'trial' }
const trial = (state: SceneState, command: SceneCommand) => toUpdater(command, TRIAL)(state)

const argOf = (command: SceneCommand): unknown => (command.args as readonly unknown[])[0]

type Plan = { kind: 'attack'; intent: Intent } | { kind: 'focus' } | { kind: 'move'; intent: Intent }

function anchorOf(state: SceneState, id: string): Coord | null {
  return state.board?.placements[id]?.cell ?? null
}

function nearestFoe(state: SceneState, members: readonly string[], id: string): { id: string; at: Coord; apart: number } | null {
  const from = anchorOf(state, id)
  if (!from) return null
  const foes = getSides(state, members).foes.flatMap((foe) => {
    const at = anchorOf(state, foe)
    return at ? [{ id: foe, at, apart: distance(from, at) }] : []
  })
  return foes.reduce<(typeof foes)[number] | null>((best, f) => (!best || f.apart < best.apart ? f : best), null)
}

function attackOn(state: SceneState, c: CampaignCharacter, target: string): Intent | null {
  for (const kind of ['strike', 'shoot'] as const) {
    for (const row of getFreeAttackOptions(state, c, kind)) {
      const intent: Intent = { actorId: c.id, option: { kind }, picks: [{ part: 'row', value: { weaponKey: row.weaponKey, attack: row.attack, variant: row.variant } }, { part: 'target', value: target }] }
      if (declare(state, intent, TRIAL).ok) return intent
    }
  }
  return null
}

// A walk at the fastest movement open, with no surge, to the cell it reaches
// nearest the foe through nobody standing (`isClearWalk`), when that is
// nearer than where the character stands.
function stepCloser(state: SceneState, id: string, foe: Coord, apart: number): Intent | null {
  const c = state.characters[id]
  const open = getMovementOptions(state, c).filter((o): o is typeof o & { kind: MovementKind } => o.available && o.speed > 0)
  const movement = open.reduce<(typeof open)[number] | null>((best, o) => (!best || o.speed > best.speed ? o : best), null)?.kind
  if (!movement) return null
  const moving = trial(trial(state, { kind: 'declare', args: [id, { kind: 'move' }] }), { kind: 'amend', args: [{ movement }] })
  const action = getOpenAction(moving)
  if (action?.kind !== 'move' || action.actorId !== id) return null
  const best = getReachableCells(moving, action as MoveAction).filter((r) => isClearWalk(moving, action as MoveAction, r.path)).reduce<{ cell: Coord; apart: number } | null>((b, r) => {
    const d = distance(r.cell, foe)
    return d < (b?.apart ?? apart) ? { cell: r.cell, apart: d } : b
  }, null)
  if (!best) return null
  const intent: Intent = { actorId: id, option: { kind: 'move' }, picks: [{ part: 'movement', value: movement }, { part: 'cell', value: best.cell }] }
  return declare(state, intent, TRIAL).ok ? intent : null
}

// What the character would do with a turn in `state`, where it holds one.
function planTurn(state: SceneState, members: readonly string[], id: string, focus = true): Plan | null {
  const c = state.characters[id]
  const foe = nearestFoe(state, members, id)
  if (!c || !foe) return null
  const attack = attackOn(state, c, foe.id)
  if (attack) return { kind: 'attack', intent: attack }
  if (focus && getFreeAttackOptions(state, c, 'shoot').length === 0 && hasUnfocusedRow(c, 'shoot', isCombatStarted(state))) return { kind: 'focus' }
  const move = stepCloser(state, id, foe.at, foe.apart)
  return move ? { kind: 'move', intent: move } : null
}

export type Find = (kind: SceneCommand['kind'], id?: string) => OpenButton | undefined
export type Press = (b: OpenButton | undefined, why: string) => Decision | null

// The buttons open to the seat, found by the command they press and whom for.
export function finding(buttons: readonly OpenButton[]): { find: Find; press: Press } {
  const find: Find = (kind, id) => buttons.find((b) => b.command.kind === kind && (id === undefined || argOf(b.command) === id))
  const press: Press = (b, why) => (b ? { kind: 'press', pick: b, why } : null)
  return { find, press }
}

// What the box does about what the table waits on a member for, but the
// answer and the turn, which `nearestBox` plays as its own: hold on to what it
// concentrates on, make the morale test, land what it rolled, and rest or say
// something at the round's rest step as `getRestChoice` weighs it with `rest`.
export function settleWait(input: SeatInput, wait: Wait, find: Find, press: Press, rest: RestTuning): Decision | null {
  const { id } = wait
  switch (wait.for) {
    case 'concentration':
      return press(find('holdOn', id) ?? find('letGo', id), 'holds on')
    case 'morale':
      return press(find('rollMorale', id) ?? find('keepMorale', id) ?? find('skipMorale', id), 'makes the morale test')
    case 'action':
      return finishAction(input, id, find, press)
    case 'rest': {
      const choice = getRestChoice(input.view(), input.members, id, rest)
      return choice ? { kind: 'declare', intent: { actorId: id, option: choice.draft, picks: [] }, why: choice.why } : null
    }
    case 'answer':
    case 'turn':
    case 'die':
      return null
  }
}

// What is left once nobody is waited on and no turn is started: agree to end
// the round, then move on what the table holds (a held test, a roll, a payment,
// a landing), then fill what is asked.
export function carryOn(input: SeatInput, find: Find): Decision {
  const { members, buttons, choices } = input
  const view = input.view()
  // agreeing while the round changes would end the round to come before it
  // begins, and while someone holds a turn or an action is open, before the
  // character has had its own turn: only once nobody plays does it say it is done
  const waiting = getRoundPhase(view) !== null || getTurnHolder(view) !== null || getOpenAction(view) !== null
  for (const id of members) {
    const agree = waiting ? undefined : find('toggleAgreeToEnd', id)
    if (agree && !hasAgreedToEnd(view, id)) return { kind: 'press', pick: agree, why: 'has nothing more to do this round' }
  }
  const held = buttons.find((b) => b.command.kind === 'rollHeld' && members.includes(argOf(b.command) as string))
  const forward = held ?? find('roll') ?? find('pay') ?? find('resolve')
  if (forward) return { kind: 'press', pick: forward, why: forward.label }
  const fill = choices.find((c) => !c.chosen)
  return fill ? { kind: 'press', pick: fill, why: fill.label } : { kind: 'wait', why: 'nothing to do' }
}

// The turn's end when there is nothing to do in it: ended, or the limit stress
// action it owes refused, or a surge it is held to made.
export function endTurn(input: SeatInput, id: string, find: Find, press: Press): Decision | null {
  return press(find('endTurn'), 'has nothing more to do this turn') ?? press(find('defaultToCoward', id), 'will not do the limit stress action it owes') ?? forcedSurge(input, id)
}

export const nearestBox: Box = (input) => {
  const { members, waits, buttons } = input
  const { find, press } = finding(buttons)

  for (const wait of waits) {
    const made = wait.for === 'answer' ? press(find('pass', wait.id), 'lets it come')
      : wait.for === 'turn' ? takeTurn(input, wait.id, find, press)
      : settleWait(input, wait, find, press, REST_TUNING)
    if (made) return made
  }

  const view = input.view()
  for (const id of members) {
    const start = find('startTurn', id)
    if (start && planTurn(trial(view, start.command), members, id)) return { kind: 'press', pick: start, why: 'has a foe to go for' }
  }
  return carryOn(input, find)
}

function finishAction(input: SeatInput, id: string, find: Find, press: Press): Decision | null {
  const view = input.view()
  const open = getOpenAction(view)
  if (open?.actorId !== id) return null
  if (open.step === 'post') {
    // a hit's overflow spent as `getBestSpend` spends it, or nothing where the table takes none of that
    const bought = isAttackAction(open) ? getBestSpendPicks(view, open) : []
    const spends = bought.length && settle(view, bought, TRIAL).ok ? bought : []
    const spent = spends.length ? `, buying ${[...new Set(spends.map((p) => String(p.value)))].map((v) => `${v} x${spends.filter((p) => p.value === v).length}`).join(', ')}` : ''
    if (settle(view, spends, TRIAL).ok) return { kind: 'settle', picks: spends, why: `lands it${spent}` }
    const fill = input.choices.find((c) => c.actorId === id && !c.chosen && settle(view, [...spends, { part: c.part, value: c.value }], TRIAL).ok)
    return fill ? { kind: 'settle', picks: [...spends, { part: fill.part, value: fill.value }], why: `lands it: ${fill.label}${spent}` } : null
  }
  return press(find('skip') ?? find('cancel'), 'lets it go')
}

function takeTurn(input: SeatInput, id: string, find: Find, press: Press): Decision | null {
  const focus = input.buttons.find((b) => b.command.kind === 'surge' && argOf(b.command) === id && b.command.args[1] === 'focus')
  const plan = planTurn(input.view(), input.members, id, !!focus)
  if (plan?.kind === 'attack') return { kind: 'declare', intent: plan.intent, why: 'attacks the nearest foe' }
  if (plan?.kind === 'focus') return press(focus, 'focuses to shoot')
  if (plan?.kind === 'move') return { kind: 'declare', intent: plan.intent, why: 'walks to the nearest foe' }
  return endTurn(input, id, find, press)
}

// A surge the turn cannot end without (one the table forces on the
// character): the first of its surges after which the turn can end or there
// is something to do.
function forcedSurge(input: SeatInput, id: string): Decision | null {
  const view = input.view()
  const surge = input.buttons.find((b) => {
    if (b.command.kind !== 'surge' || argOf(b.command) !== id) return false
    const after = trial(view, b.command)
    return after !== view && (getEndTurnBar(after) === null || planTurn(after, input.members, id) !== null)
  })
  return surge ? { kind: 'press', pick: surge, why: `makes the ${String(surge.command.args[1])} surge it is held to` } : null
}
