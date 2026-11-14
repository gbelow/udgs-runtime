import type { Coord, MovementKind } from '../../types'
import type { ActionDraft, MoveAction, SceneState } from '../../scene/types'
import { toUpdater, type CommandContext, type SceneCommand } from '../../scene/commands/registry'
import { getOpenAction } from '../../scene/rules/log'
import { getAvailableActions, getUnfinishedAnswers } from '../../scene/rules/options'
import { getOpenChoices } from '../../scene/projections/choices'
import { getMovementOptions } from '../../scene/rules/move'
import { getReachableCells } from '../../scene/rules/board/reach'
import { distance, sameCell } from '../../scene/rules/board/geometry'
import { declare, type Intent, type Pick } from '../declare'
import { getSides } from '../table'
import { getPair, type PairAttack, type PairDefence } from '../pairs'
import { cellOf, getDanger, getDefendedHarm, getHarmAgainst, getMeans, getPotentialThreat, getThreatened, getThreatening, threatValue, THREAT_TUNING, type ThreatTuning } from '../threat'
import { carryOn, endTurn, finding, settleWait, type Find, type Press } from './nearest'
import type { Box, Decision, SeatInput } from '../decision'

// Moves by potential threat and attacks by immediate threat (bot/threat.ts),
// every term weighed by a tweakable:
//
// - an attack, from where the character stands or from a cell it can walk to
//   this turn, is worth its expected harm on the target (against the defence
//   the target is believed able to pay for), how threatened the target is by
//   the whole team, and how threatening it is to anyone in the team, less
//   what it costs (the walk and the attack, AP + STA) at a price that rises
//   with the danger the character is left in: the worst single foe's
//   immediate threat on it, at the cell, with the AP it has left to defend;
// - with no attack worth making, a walk is worth the potential harm the
//   character could do from the cell to the foe it threatens most, less the
//   worst single foe's potential threat on it there, less the walk at the
//   same price; it walks when that beats standing by a margin;
// - attacked, it answers with the defence (or none) that leaves the least
//   harm and price together.
//
// The rest (morale, concentration, landing what it rolled, a surge it is held
// to) it plays as the nearest box does.

export type ThreatWeights = ThreatTuning & {
  harm: number
  threatened: number
  threatening: number
  // the price of an AP or STA: `cost` plus `danger` times the danger the character is left in
  cost: number
  danger: number
  // a walk's worth: the potential harm the character could do from the cell, the potential danger there
  offence: number
  peril: number
  // what a walk must beat standing still by
  margin: number
}

export const THREAT_WEIGHTS: ThreatWeights = { ...THREAT_TUNING, harm: 1, threatened: 0.2, threatening: 0.2, cost: 1, danger: 0.1, offence: 1, peril: 1, margin: 1 }

const TRIAL: CommandContext = { thrower: () => 0, newId: () => 'trial' }
const trial = (state: SceneState, command: SceneCommand) => toUpdater(command, TRIAL)(state)
const argOf = (command: SceneCommand): unknown => (command.args as readonly unknown[])[0]

type Walk = { movement: MovementKind; cells: { cell: Coord; AP: number; STA: number }[] }

// The cells the character can walk to this turn at its fastest movement, with
// no surge, and what the walk costs.
function getWalk(state: SceneState, id: string): Walk | null {
  const c = state.characters[id]
  if (!c) return null
  const open = getMovementOptions(state, c).filter((o): o is typeof o & { kind: MovementKind } => o.available && o.speed > 0)
  const movement = open.reduce<(typeof open)[number] | null>((best, o) => (!best || o.speed > best.speed ? o : best), null)?.kind
  if (!movement) return null
  const moving = trial(trial(state, { kind: 'declare', args: [id, { kind: 'move' }] }), { kind: 'amend', args: [{ movement }] })
  const action = getOpenAction(moving)
  if (action?.kind !== 'move' || action.actorId !== id) return null
  return { movement, cells: getReachableCells(moving, action as MoveAction).map((r) => ({ cell: r.cell, AP: r.cost.AP, STA: r.cost.STA })) }
}

const moveIntent = (id: string, movement: MovementKind, cell: Coord): Intent => ({ actorId: id, option: { kind: 'move' }, picks: [{ part: 'movement', value: movement }, { part: 'cell', value: cell }] })

const attackIntent = (id: string, attack: PairAttack, target: string): Intent => ({ actorId: id, option: { kind: attack.kind }, picks: [{ part: 'row', value: attack.row }, { part: 'target', value: target }] })

type Plan =
  | { kind: 'attack'; intent: Intent; score: number; why: string }
  | { kind: 'walk'; intent: Intent; score: number; why: string }
  | { kind: 'focus'; score: number; why: string }

// What the character would do with the turn it holds in `view`, or null to end it.
function planTurn(view: SceneState, members: readonly string[], id: string, w: ThreatWeights): Plan | null {
  const me = view.characters[id]
  const here = cellOf(view, id)
  if (!me) return null
  const means = getMeans(me, true, w)
  const { foes } = getSides(view, members)
  if (foes.length === 0) return null
  const walk = getWalk(view, id)
  const cells = [{ cell: here, AP: 0, STA: 0 }, ...(walk?.cells.filter((c) => !here || !sameCell(c.cell, here)) ?? [])]
  const price = (AP: number, STA: number, at: Coord | null) => (AP + STA) * (w.cost + w.danger * getDanger(view, members, id, 'immediate', at, { AP: means.AP - AP, STA: means.STA - STA }, w))

  const targetWorth = new Map(foes.map((f) => [f, w.threatened * getThreatened(view, members, f, w) + w.threatening * getThreatening(view, members, f, w)]))
  let best: Plan | null = null
  for (const { cell, AP, STA } of cells) {
    for (const foe of foes) {
      const target = view.characters[foe]
      const at = cellOf(view, foe)
      if (!target) continue
      const gap = cell && at ? distance(cell, at) : 0
      const guard = getMeans(target, false, w)
      for (const attack of getPair(me, target)) {
        if (gap > attack.reach) continue
        const needsFocus = attack.needsFocus && me.usedSurge !== 'focus'
        if (needsFocus && me.usedSurge !== null) continue
        const spendAP = AP + attack.cost.AP
        const spendSTA = STA + attack.cost.STA
        if (spendAP > means.AP || spendSTA > means.STA) continue
        const harm = getDefendedHarm(attack, gap, guard)?.harm ?? 0
        if (harm <= 0) continue
        const score = w.harm * harm + (targetWorth.get(foe) ?? 0) - price(spendAP, spendSTA, cell)
        if (best && score <= best.score) continue
        const why = `${attack.kind}s ${target.name} (${attack.row.attack}, harm ${harm.toFixed(1)}, score ${score.toFixed(1)})`
        if (needsFocus) best = { kind: 'focus', score, why: `focuses to shoot: ${why}` }
        else if (!here || !cell || sameCell(cell, here)) best = { kind: 'attack', intent: attackIntent(id, attack, foe), score, why }
        else if (walk) best = { kind: 'walk', intent: moveIntent(id, walk.movement, cell), score, why: `walks to attack: ${why}` }
      }
    }
  }
  if (best && best.score > 0 && (best.kind !== 'attack' || declare(view, best.intent, TRIAL).ok) && (best.kind !== 'walk' || declare(view, best.intent, TRIAL).ok)) return best

  if (!walk || !here) return null
  const standing = (cell: Coord): number => {
    const offence = foes.reduce((most, foe) => Math.max(most, threatValue(getPotentialThreat(view, members, id, foe, cellOf(view, foe), cell, w), w)), 0)
    return w.offence * offence - w.peril * getDanger(view, members, id, 'potential', cell, undefined, w)
  }
  const stay = standing(here)
  let move: { cell: Coord; score: number } | null = null
  for (const { cell, AP, STA } of walk.cells) {
    if (sameCell(cell, here)) continue
    const score = standing(cell) - price(AP, STA, cell)
    if (!move || score > move.score) move = { cell, score }
  }
  if (!move || move.score <= stay + w.margin) return null
  const intent = moveIntent(id, walk.movement, move.cell)
  return declare(view, intent, TRIAL).ok ? { kind: 'walk', intent, score: move.score, why: `walks where it threatens more and is threatened less (${move.score.toFixed(1)} over ${stay.toFixed(1)})` } : null
}

// The answer to an attack on `id`: the defence offered that leaves the least
// harm and price together, or none.
function answer(input: SeatInput, id: string, w: ThreatWeights, find: Find, press: Press): Decision | null {
  const view = input.view()
  const open = getOpenAction(view)
  const me = view.characters[id]
  if (!open || !me || open.targetId !== id || (open.kind !== 'strike' && open.kind !== 'shoot')) return press(find('pass', id), 'lets it come')
  const attacker = view.characters[open.actorId]
  const attack = attacker ? getPair(attacker, me).find((a) => a.kind === open.kind && a.row.weaponKey === open.weaponKey && a.row.attack === open.attack && a.row.variant === open.variant) : undefined
  if (!attack) return press(find('pass', id), 'lets it come: does not know the attack')
  const from = cellOf(view, open.actorId)
  const at = cellOf(view, id)
  const gap = from && at ? distance(from, at) : 0
  const means = getMeans(me, true, w)
  const offered = getAvailableActions(view, id).filter((o) => o.available && o.reactionTo === open.id)
  const worth = (d: PairDefence) => getHarmAgainst(attack, d, gap)
  const none = attack.defences.find((d) => d.draft === null)
  let best: { draft: ActionDraft | null; score: number } = { draft: null, score: none ? worth(none) : 0 }
  for (const o of offered) {
    const d = attack.defences.find((x) => x.draft && sameDraft(x.draft, o.draft))
    if (!d) continue
    const priced = (d.cost.AP + d.cost.STA) * (w.cost + w.danger * getDanger(view, input.members, id, 'immediate', at, { AP: means.AP - d.cost.AP, STA: means.STA - d.cost.STA }, w))
    const score = worth(d) + priced
    if (score < best.score) best = { draft: o.draft, score }
  }
  if (best.draft === null) return press(find('pass', id), `lets it come (harm ${best.score.toFixed(1)})`)
  const picks = fillAnswer(view, input.members, id, best.draft, { AP: means.AP, STA: means.STA })
  if (!picks) return press(find('pass', id), `lets it come: ${best.draft.kind} cannot be finished`)
  return { kind: 'declare', intent: { actorId: id, option: best.draft, picks }, why: `answers with ${best.draft.kind} (harm and price ${best.score.toFixed(1)})` }
}

// What the answer still asks for once declared (where an evasive jump lands),
// picked: a cell where the danger on the character is least, anything else as
// first offered. Null when it asks for something nothing offers.
function fillAnswer(view: SceneState, members: readonly string[], id: string, draft: ActionDraft, guard: { AP: number; STA: number }): Pick[] | null {
  const open = getOpenAction(view)
  if (!open) return null
  const picks: Pick[] = []
  for (let i = 0; i < 4; i++) {
    const made = declare(view, { actorId: id, option: draft, picks }, TRIAL)
    if (!made.ok) return null
    if (!getUnfinishedAnswers(made.ready, open).some((r) => r.actorId === id)) return picks
    const fills = getOpenChoices(made.ready).filter((c) => c.actorId === id && !c.chosen)
    const cells = fills.filter((c) => c.part === 'cell')
    const pick = cells.length
      ? cells.reduce((b, c) => (getDanger(view, members, id, 'immediate', c.value as Coord, guard) < getDanger(view, members, id, 'immediate', b.value as Coord, guard) ? c : b))
      : fills[0]
    if (!pick) return null
    picks.push({ part: pick.part, value: pick.value })
  }
  return null
}

function sameDraft(a: ActionDraft, b: ActionDraft): boolean {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && JSON.stringify((a as Record<string, unknown>)[k]) === JSON.stringify((b as Record<string, unknown>)[k]))
}

function takeTurn(input: SeatInput, id: string, w: ThreatWeights, find: Find, press: Press): Decision | null {
  const plan = planTurn(input.view(), input.members, id, w)
  if (plan?.kind === 'attack' || plan?.kind === 'walk') return { kind: 'declare', intent: plan.intent, why: plan.why }
  if (plan?.kind === 'focus') {
    const focus = input.buttons.find((b) => b.command.kind === 'surge' && argOf(b.command) === id && b.command.args[1] === 'focus')
    const made = press(focus, plan.why)
    if (made) return made
  }
  return endTurn(input, id, find, press) ?? getAway(input.view(), input.members, id)
}

// A walk the turn cannot end without (a coward's run): to the cell where the
// worst foe's potential threat is least.
function getAway(view: SceneState, members: readonly string[], id: string): Decision | null {
  const walk = getWalk(view, id)
  if (!walk) return null
  const safest = walk.cells
    .map((c) => ({ cell: c.cell, danger: getDanger(view, members, id, 'potential', c.cell) }))
    .sort((a, b) => a.danger - b.danger)
    .find((c) => declare(view, moveIntent(id, walk.movement, c.cell), TRIAL).ok)
  return safest ? { kind: 'declare', intent: moveIntent(id, walk.movement, safest.cell), why: `gets away (danger ${safest.danger.toFixed(1)})` } : null
}

export function threatBox(w: ThreatWeights = THREAT_WEIGHTS): Box {
  return (input) => {
    const { members, waits, buttons } = input
    const { find, press } = finding(buttons)
    for (const wait of waits) {
      const made = wait.for === 'answer' ? answer(input, wait.id, w, find, press)
        : wait.for === 'turn' ? takeTurn(input, wait.id, w, find, press)
        : settleWait(input, wait, find, press)
      if (made) return made
    }
    const view = input.view()
    for (const id of members) {
      const start = find('startTurn', id)
      if (start && planTurn(trial(view, start.command), members, id, w)) return { kind: 'press', pick: start, why: 'has something worth doing' }
    }
    return carryOn(input, find)
  }
}

