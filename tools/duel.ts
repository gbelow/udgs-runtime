import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SceneStateSchema, type HitLocation, type ActionDraft, type ActionKind, type SceneState, type Coord, type RootAction } from '../app/domain/scene/types'
import { rollD10, seededRng, type Dice } from '../app/domain/play/dice'
import { buildFighter } from './lib/fighters'
import type { CampaignCharacter } from '../app/domain/types'
import { addInstance } from '../app/domain/instances'
import { setDistance } from '../app/domain/scene/rules/board/geometry'
import { board } from '../app/domain/bot/fixtures'
import { getAttackRows } from '../app/domain/bot/weapons'
import { isWorthTheAP, rankAttacks, WORTH_TIER } from '../app/domain/bot/estimate'
import { getStanding, type Evaluations } from '../app/domain/bot/evaluation'
import { makeAftermathReader } from '../app/domain/bot/afterAttack'
import { readGrabs, type Posture } from '../app/domain/bot/grapplePosture'
import { isGrappleRowOf } from '../app/domain/scene/rules/grapple'
import { canGrapple, getHOPOptions, getHOPRemaining } from '../app/domain/scene/rules/damage'
import { chooseGrapple, refundHOP, spendHOP } from '../app/domain/scene/commands/choices'
import { getAvailableActions } from '../app/domain/scene/rules/options'
import { getTargetIds, isDeclarationComplete, needsTarget } from '../app/domain/scene/rules/action'
import { canAfford } from '../app/domain/character/rules/cost'
import { canSurge, getSurgeAP, getSurgeAPLeft } from '../app/domain/character/rules/surge'
import { SURGES } from '../app/domain/tables'
import { surgeKinds } from '../app/domain/lists'
import { declareDefense } from '../app/domain/bot/answer'
import { hold } from '../app/domain/bot/engine'
import { passUp } from '../app/domain/bot/table'
import { getLiveFoes, isStanding, type Party } from '../app/domain/bot/party'
import { getEvasiveJumpPlacements } from '../app/domain/scene/rules/move'
import { getReachableCells } from '../app/domain/scene/rules/board/reach'
import { amendAction, commitAction, declareAction, amendReaction, declareReaction, resolveAction, rollOrPay, setTarget } from '../app/domain/scene/commands/action'
import { endTurn, startTurn, surge, toggleAgreeToEnd } from '../app/domain/scene/commands/turn'
import { continueRound, holdOn, letGo, nextRound } from '../app/domain/scene/commands/nextRound'
import { getConcentrationOwed, getContinueBar, getHoldOnBar, getRoundPhase } from '../app/domain/scene/rules/roundChange'
import { getAction, getHistory, getLiveReactionsTo, getOpenAction } from '../app/domain/scene/rules/log'
import { getNextRoundBar, getSurgeTurnBar, getTurnHolder, hasAgreedToEnd } from '../app/domain/scene/rules/turn'
import { getCompelledSurge } from '../app/domain/scene/rules/stress'
import { getMoraleTest } from '../app/domain/scene/rules/morale'
import { rollMorale } from '../app/domain/scene/commands/morale'
import { getFightName } from '../app/domain/scene/rules/fighters'
import { getLastEpisode, type EpisodeEntry } from '../app/domain/scene/projections/episode'
import type { ActionRoll, CostTerm } from '../app/domain/scene/types'
import type { ActionCost } from '../app/domain/character/rules/actionCosts'
import { getActionPanel } from '../app/domain/scene/projections/actionPanel'
import { HOP_LABELS, getOptionLabel } from '../app/domain/scene/projections/labels'
import { getAfflictions, getInjuryPenalty, isDead } from '../app/domain/character/rules/afflictions'

// A two-sided fight played by hand, one decision at a time, for an agent or a
// person to play from a strategy file. The state lives in a JSON file between
// calls; what a side may do is read off the same rules the panel reads, and
// whatever nobody owes a decision on (dice, landing, the round turning) is
// done for them.
//
//   pnpm duel new "Human Warrior:Longsword" "Human Warrior:Halberd" [--seed n] [--distance n] [--rounds n] [--game name]
//   pnpm duel show [--ahead] [--game name]   what the side to act sees; --ahead adds what
//                                     each attack leaves the table and what a grab changes
//   pnpm duel do <n> [--game name]    take choice n
//   pnpm duel log [--game name]       every action so far

type Side = 'A' | 'B'
const SIDES: readonly Side[] = ['A', 'B']
const FOLLOW_UPS: readonly ActionKind[] = ['fleeFollowUp', 'move', 'strike', 'feint', 'grapple']
const IDS: Record<Side, string> = { A: 'a', B: 'b' }
const PARTIES: Party[] = [{ members: ['a'] }, { members: ['b'] }]

type Saved = {
  state: SceneState
  specs: Record<Side, string>
  seed: number
  draws: number
  ids: number
  maxRounds: number
  events: string[]
  lastKey: string
  // what the attacks come to for the gear and gap met so far
  evaluations?: Evaluations
}

// The evaluations kept between calls and whether the lines that look one action
// ahead are worked out; set once per call.
const session: { evaluations: Evaluations; ahead: boolean } = { evaluations: {}, ahead: false }

type Env = { dice: Dice; newId: () => string; counters: () => { draws: number; ids: number } }

type Choice = { label: string; apply: (env: Env, aim?: string) => SceneState | null; unavailable?: string }
type Prompt = { kind: 'prompt'; side: Side; title: string; choices: Choice[]; note?: string }
type End = { kind: 'end'; text: string }

const DIR = path.join(process.cwd(), 'reports', 'duel')

function makeEnv(saved: Pick<Saved, 'seed' | 'draws' | 'ids'>): Env {
  const base = seededRng(saved.seed)
  let draws = saved.draws
  let ids = saved.ids
  for (let i = 0; i < saved.draws; i++) base()
  const rng = () => { draws++; return base() }
  return { dice: (explodes) => rollD10(explodes, rng), newId: () => `x${++ids}`, counters: () => ({ draws, ids }) }
}

function create(specA: string, specB: string, seed: number, distance: number, maxRounds: number): Saved {
  const env = makeEnv({ seed, draws: 0, ids: 0 })
  const characters: CampaignCharacter[] = []
  const placements: Record<string, [number, number]> = {}
  for (const side of SIDES) {
    const spec = side === 'A' ? specA : specB
    const added = addInstance(buildFighter(IDS[side], spec, side), Object.fromEntries(characters.map((c) => [c.id, c])), env.newId, characters.map((c) => c.id))
    characters.push(added)
    placements[added.id] = [side === 'A' ? 0 : distance, 0]
  }
  const { draws, ids } = env.counters()
  return { state: board(placements, ...characters), specs: { A: specA, B: specB }, seed, draws, ids, maxRounds, events: [], lastKey: '' }
}

function sideOf(id: string): Side {
  return id === IDS.A ? 'A' : 'B'
}

function partyOf(id: string): Party {
  return PARTIES[SIDES.indexOf(sideOf(id))]
}

function cellOf(state: SceneState, id: string): Coord | null {
  return state.board?.placements[id]?.cell ?? null
}

function gapBetween(state: SceneState, a: string, b: string): number | null {
  const ca = cellOf(state, a)
  const cb = cellOf(state, b)
  return ca && cb ? setDistance([ca], [cb]) : null
}

function isCommitted(state: SceneState, id: string): boolean {
  const action = getAction(state, id)
  return action !== null && action.step !== 'define'
}

const cost = (c: { AP?: number; STA?: number } | null) => `${c?.AP ?? 0} AP, ${c?.STA ?? 0} STA`

// An action declared by `id` and still to be filled in and committed: one just
// declared in their turn, or a follow-up the rules opened for them.
type Base = { state: SceneState; open: RootAction; own: boolean }

function begin(state: SceneState, id: string, draft: ActionDraft, env: Env): Base | null {
  const declared = declareAction(id, draft, env.newId)(state)
  const open = getOpenAction(declared)
  return open && open.kind === draft.kind && open.step === 'define' ? { state: declared, open, own: true } : null
}

function committing(base: Base, e: Env, amend: (s: SceneState) => SceneState): SceneState | null {
  const committed = commitAction(e.dice, e.newId)(amend(base.state))
  return isCommitted(committed, base.open.id) ? committed : null
}

// Every strike the character may make from the base: each row and variation
// at each foe it could be aimed at. A row it cannot pay for or reach stays
// listed with the reason, so the numbers do not move.
// What taking hold does to each side's prospects, against the same hit left
// unheld: how much it can do to the other, and how much the other can do to it.
function grabNote(reading: ReturnType<typeof readGrabs>[number] | undefined): string {
  if (!reading) return ''
  const word = (was: number, now: number, goodWhenUp: boolean) => Math.abs(now - was) < 0.05 ? 'the same' : (now > was) === goodWhenUp ? 'better' : 'worse'
  const side = (who: string, was: Posture['attacker'], now: Posture['attacker']) =>
    `${who} offense ${word(was.offense, now.offense, true)} (${was.offense.toFixed(2)} to ${now.offense.toFixed(2)}), defense ${word(was.taken, now.taken, false)} (injury taken ${was.taken.toFixed(2)} to ${now.taken.toFixed(2)}, ${now.answers} answer${now.answers === 1 ? "" : "s"} left)`
  return `; if it hits and you grab: ${side('yours', reading.apart.attacker, reading.held.attacker)}; ${side('theirs', reading.apart.foe, reading.held.foe)}`
}

function strikeChoices(base: Base, id: string, foes: string[], state: SceneState, shut: string | null): Choice[] {
  const mine = state.characters[id]
  const targets = base.own ? foes : base.open.targetId ? [base.open.targetId] : []
  const estimates = base.own ? new Map(targets.map((f) => [f, getStanding(session.evaluations, state, id, f)])) : new Map<string, ReturnType<typeof getStanding>>()
  const readers = new Map(session.ahead ? targets.map((f) => [f, makeAftermathReader(session.evaluations, state, id, f)]) : [])
  const grabs = new Map<string, ReturnType<typeof readGrabs>>()
  const grabsAt = (f: string) => grabs.get(f) ?? grabs.set(f, session.ahead && base.own ? readGrabs(session.evaluations, state, id, f) : []).get(f)!
  return getAttackRows(state, id, 'strike').flatMap((option) => targets.map((target): Choice => {
    const guess = estimates.get(target)?.find((e) => e.attack === option.attack && e.variant === option.variant && e.weapon === option.weapon)
    const after = guess && readers.get(target)?.(guess)
    const afterNote = after ? `; then you have ${after.attackerLeft.AP} AP ${after.attackerLeft.STA} STA, they ${after.foeLeft.AP} AP ${after.foeLeft.STA} STA, and their best attack on you is ${after.reply ? `${after.reply.weapon} ${after.reply.attack} (${after.reply.variant}), expected injury ${after.reply.expectedIL.toFixed(2)} against your ${after.reply.guarded.label}` : 'none'}` : ''
    const expected = guess ? `; estimate vs best answer (${guess.guarded.label}): hit ${(guess.guarded.pHit * 100).toFixed(0)}%, graze ${(guess.guarded.pGraze * 100).toFixed(0)}%, expected injury ${guess.expectedIL.toFixed(2)} for ${guess.totalCost.AP.toFixed(1)} AP ${guess.totalCost.STA.toFixed(1)} STA (${guess.ilPerCost.toFixed(2)} per cost, breakage not counted); best case unanswered: ${guess.bestCase.tier === null ? 'no injury' : `tier ${guess.bestCase.tier}, IL +${guess.bestCase.IL}`}${isWorthTheAP(guess) ? '' : ` (below tier ${WORTH_TIER}, not worth the AP)`}${afterNote}` : ''
    const grabbing = grabNote(isGrappleRowOf(mine, option.weaponKey, option.attack) ? grabsAt(target).find((g) => g.weapon === option.weaponKey && g.attack === option.attack && g.variant === option.variant) : undefined)
    const label = `attack with ${option.weapon} ${option.attack} (${option.variant}) at ${getFightName(state, target)} - ${option.AP} AP, ${option.STA} STA, weapon cut ${option.cut} blunt ${option.blunt}, to-hit penalty ${option.penalty}${expected}${grabbing}`
    const row = { weaponKey: option.weaponKey, attack: option.attack, variant: option.variant }
    const armed = amendAction(row)(base.state)
    const aimable = getOpenAction(armed)
    const reaches = aimable !== null && getTargetIds(armed, aimable).includes(target)
    const apply = (e: Env, aim?: string) => committing(base, e, (s) => {
      const aimed = base.own ? setTarget(target)(amendAction(row)(s)) : amendAction(row)(s)
      return aim ? amendAction(placeOf(aimed, aim))(aimed) : aimed
    })
    const why = shut ?? (!canAfford(mine, option) ? `needs ${option.AP} AP and ${option.STA} STA, you have ${mine.resources.AP} AP and ${mine.resources.STA} STA` : !reaches ? 'the foe is out of reach' : null)
    return { label, apply, ...(why ? { unavailable: why } : {}) }
  }))
}

// Where a blow can be aimed on the target of the declared strike, with what each
// costs to hit.
function places(state: SceneState): { location: HitLocation; part: string | null; name: string; penalty: number }[] {
  return getActionPanel(state).locations
}

function placeOf(state: SceneState, name: string): { location: HitLocation; part: string | null } {
  const found = places(state).find((l) => l.name.toLowerCase() === name.toLowerCase())
  if (!found) throw new Error(`No place "${name}" to aim at here. Choose one of: ${places(state).map((l) => l.name).join(', ')}`)
  return { location: found.location, part: found.part }
}

// The places worth walking to from the base, each way of moving, one per
// distance from the foe.
function moveChoices(base: Base, id: string, state: SceneState): Choice[] {
  const origin = cellOf(state, id)
  const foeCells = getLiveFoes(state, partyOf(id)).flatMap((f) => cellOf(state, f) ?? [])
  if (!origin || foeCells.length === 0) return []
  const here = setDistance([origin], foeCells)
  const moves: Choice[] = []
  for (const movement of ['basic', 'run'] as const) {
    const moving = amendAction({ movement })(base.state)
    const aimed = getOpenAction(moving)
    if (aimed?.kind !== 'move') continue
    const byGap = new Map<number, ReturnType<typeof getReachableCells>[number]>()
    for (const to of getReachableCells(moving, aimed)) {
      const gap = setDistance([to.cell], foeCells)
      if (gap === here || gap > here + 3) continue
      const best = byGap.get(gap)
      if (!best || to.steps < best.steps) byGap.set(gap, to)
    }
    for (const [gap, to] of [...byGap].sort((x, y) => x[0] - y[0])) {
      moves.push({
        label: `move (${movement}) to ${gap} cell${gap === 1 ? '' : 's'} from the foe - ${to.steps} step${to.steps === 1 ? '' : 's'}, ${to.cost.AP} AP, ${to.cost.STA} STA`,
        apply: (e) => committing(base, e, amendAction({ movement, path: to.path })),
      })
    }
  }
  return moves
}

const UNSUPPORTED = 'the harness cannot declare this by itself (it needs choices it does not offer yet)'

// An action with nothing to pick but a target: declared and committed as it is.
function plainChoices(base: Base | null, label: string, foes: string[], state: SceneState): Choice[] {
  if (!base) return [{ label, apply: () => null, unavailable: UNSUPPORTED }]
  const targets = needsTarget(base.open) ? foes : [null]
  return targets.map((target): Choice => ({
    label: target ? `${label} at ${getFightName(state, target)}` : label,
    apply: (e) => committing(base, e, (s) => (target ? setTarget(target)(s) : s)),
  }))
}

function aimNote(state: SceneState, id: string, foes: string[], env: Env): string | undefined {
  const foe = foes[0]
  const base = foe ? begin(state, id, { kind: 'strike' }, env) : null
  const row = base ? getAttackRows(state, id, 'strike')[0] : undefined
  if (!base || !foe || !row) return undefined
  const aimed = setTarget(foe)(amendAction({ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant })(base.state))
  const list = places(aimed)
  return list.length > 1 ? `Aim: an attack is made at the chest unless you add --aim <place>, which changes the to-hit penalty: ${list.map((l) => `${l.name} ${l.penalty >= 0 ? '+' : ''}${l.penalty}`).join(', ')}.` : undefined
}

// What each foe's best attacks would do to this character as things stand, the
// same estimate as for their own attacks with the roles turned: the character
// answering as it best can, the foe paying what each attack costs.
function threatNote(state: SceneState, id: string, foes: string[]): string | undefined {
  const lines = foes.flatMap((foe) => rankAttacks(getStanding(session.evaluations, state, foe, id)).slice(0, 3).map((e) => {
    const g = e.guarded
    return `  ${getFightName(state, foe)} with ${e.weapon} ${e.attack} (${e.variant}), ${e.cost.AP} AP ${e.cost.STA} STA: answered by ${g.label} (${g.cost.AP} AP ${g.cost.STA} STA), hit ${(g.pHit * 100).toFixed(0)}%, graze ${(g.pGraze * 100).toFixed(0)}%, expected injury ${e.expectedIL.toFixed(2)}`
  }))
  return lines.length > 0 ? `Their best attacks on you now, with you answering as you best can:\n${lines.join('\n')}` : undefined
}

function probeOf(env: Env): Env {
  let n = 0
  return { dice: () => 5, newId: () => `probe${++n}`, counters: env.counters }
}

// What the holder of the turn may do: each thing the rules list as open or
// closed for them, expanded into what has to be picked before it can be
// committed, then end the turn or pass for the round.
function turnChoices(state: SceneState, id: string, env: Env): Choice[] {
  const foes = getLiveFoes(state, partyOf(id))
  const choices = getAvailableActions(state, id).flatMap((option): Choice[] => {
    const draft = option.draft
    const label = `${getOptionLabel(state, id, option)} - ${cost(option.cost)}`
    const shut = option.available ? null : option.reason ?? 'closed'
    if (draft.kind === 'strike') {
      const base = begin(state, id, draft, env)
      return base ? strikeChoices(base, id, foes, state, shut) : [{ label, apply: () => null, unavailable: shut ?? UNSUPPORTED }]
    }
    if (shut) return [{ label, apply: () => null, unavailable: shut }]
    if (draft.kind === 'move') {
      const base = begin(state, id, draft, env)
      return base ? moveChoices(base, id, state) : []
    }
    return plainChoices(begin(state, id, draft, env), label, foes, state)
  })

  const probe = probeOf(env)
  const mine = state.characters[id]
  const surges = surgeKinds.map((kind): Choice => {
    const { STA, earmarked } = SURGES[kind]
    const gives = getSurgeAP(kind)(mine)
    const bar = getSurgeTurnBar(state, id, kind) ?? (canSurge(kind)(mine) ? null : mine.usedSurge !== null ? `already made the ${mine.usedSurge} surge this round` : 'cannot make it now (cost or affliction)')
    return {
      label: `SURGE ${kind}: -${STA} STA, +${gives} AP${earmarked ? ` that only the ${kind} surge's own actions can spend` : ''}. One per round${getCompelledSurge(state, id) === kind ? '; you are compelled to make this one' : ''}`,
      apply: () => { const made = surge(id, kind)(state); return made === state ? null : made },
      ...(bar ? { unavailable: bar } : {}),
    }
  })
  return [
    { label: 'END TURN (the other side may act. If it has nothing left to do you are asked to start another turn; PASS is what stops you acting for the round)', apply: () => { const ended = endTurn(state); return ended === state ? null : ended } },
    { label: 'PASS for the rest of the round, keeping the AP you have left to defend with', apply: () => hold(state, id) },
    ...surges,
    ...choices.map((c): Choice => (c.unavailable || c.apply(probe) !== null ? c : { ...c, unavailable: c.label.startsWith('attack') ? 'cannot be done now' : UNSUPPORTED })),
  ]
}

// A follow-up the rules opened for a character: let it go, or take it as they
// may.
function followUpChoices(state: SceneState, id: string, open: RootAction): Choice[] {
  const base: Base = { state, open, own: false }
  const foes = getLiveFoes(state, partyOf(id))
  const decline: Choice = { label: 'DECLINE: let the follow-up go', apply: (e) => passUp(state, open, e.newId) }
  const taken = ((): Choice[] => {
    switch (open.kind) {
      case 'fleeFollowUp': return [{ label: 'FLEE: activate the movement surge and take a turn limited to movement', apply: (e) => { const c = commitAction(e.dice, e.newId)(amendAction({ flee: true })(state)); return c === state ? null : c } }]
      case 'strike': return strikeChoices(base, id, foes, state, null)
      case 'move': return moveChoices(base, id, state)
      default: return plainChoices(base, getActionPanel(state).open?.label ?? open.kind, foes, state)
    }
  })()
  const env = { counters: () => ({ draws: 0, ids: 0 }) } as Env
  const probe = probeOf(env)
  return [decline, ...taken.map((c): Choice => (c.unavailable || c.apply(probe) !== null ? c : { ...c, unavailable: 'cannot be done now' }))]
}

// What a character may answer a committed action with, as the rules list it:
// the options open to them and those closed with the reason, an evasive jump
// to each distance from the actor it can land at.
function reactionChoices(state: SceneState, id: string, open: RootAction): Choice[] {
  const from = cellOf(state, open.actorId)
  return getAvailableActions(state, id).flatMap((option): Choice[] => {
    const label = `${getOptionLabel(state, id, option)} - ${cost(option.cost)}`
    if (!option.available) return [{ label, apply: () => null, unavailable: option.reason ?? 'closed' }]
    if (option.draft.kind === 'opportunityAttack' || option.draft.kind === 'counterattack') {
      return getAttackRows(state, id, 'strike').map((row): Choice => ({
        label: `${getOptionLabel(state, id, option)} with ${row.weapon} ${row.attack} (${row.variant}) - ${row.AP} AP, ${row.STA} STA, weapon cut ${row.cut} blunt ${row.blunt}, to-hit penalty ${row.penalty}`,
        apply: (e) => {
          const declared = declareReaction(id, option.draft, e.newId)(state)
          const amended = amendReaction(id, { weaponKey: row.weaponKey, attack: row.attack, variant: row.variant })(declared)
          const reaction = getLiveReactionsTo(amended, open.id).find((r) => r.actorId === id)
          return reaction && isDeclarationComplete(amended, amended.characters[id], reaction) ? amended : null
        },
      }))
    }
    if (option.draft.kind !== 'evasiveJump' || !from) return [{ label, apply: (e) => declareDefense(state, id, open, option, e.newId) }]
    const landings = new Set<number>()
    return getEvasiveJumpPlacements(state, id, open.actorId).flatMap((to): Choice[] => {
      const gap = setDistance([to.cell], [from])
      if (landings.has(gap)) return []
      landings.add(gap)
      return [{
        label: `evasive jump, landing ${gap} cell${gap === 1 ? '' : 's'} from the attacker - ${cost(option.cost)}`,
        apply: (e) => {
          const declared = declareReaction(id, { kind: 'evasiveJump', to }, e.newId)(state)
          return getLiveReactionsTo(declared, open.id).some((r) => r.actorId === id) ? declared : null
        },
      }]
    })
  })
}

function defenseChoices(state: SceneState, id: string, env: Env): Choice[] {
  const open = getOpenAction(state)
  if (!open) return []
  const probe = probeOf(env)
  const answers = reactionChoices(state, id, open).map((c): Choice => (c.unavailable || c.apply(probe) !== null ? c : { ...c, unavailable: 'cannot be done that way now' }))
  return [{ label: 'NO DEFENSE: let it happen', apply: (e) => rollOrPay(e.dice, e.newId)(state) }, ...answers]
}

function terms(list: readonly { label: string; value: number }[]): string {
  return list.map((t) => `${t.label} ${t.value >= 0 ? '+' : ''}${t.value}`).join(', ')
}

function threat(state: SceneState): string {
  const o = getActionPanel(state).open
  if (!o) return ''
  if (o.weapon === '') return `${o.actor}: ${o.label}.`
  const place = o.location === 'chest' ? '' : `, aimed at the ${o.location}`
  return `${o.actor} attacks with ${o.attack} (${o.variant})${place}. The attacker's skill is ${o.score.total} (${terms(o.score.terms)}); add a d10 against a DL of ${o.DL.total} (${terms(o.DL.terms)}) before any defense.`
}

function over(state: SceneState): End | null {
  const standing = SIDES.filter((s) => isStanding(state, IDS[s]) && !state.surrendered.includes(IDS[s]))
  if (standing.length === 2) return null
  if (standing.length === 0) return { kind: 'end', text: 'Both sides have fallen.' }
  return { kind: 'end', text: `Side ${standing[0]} wins: ${getFightName(state, IDS[standing[0]])} is the last one standing.` }
}

// Plays what nobody owes a decision on, up to the next decision or the end.
function advance(initial: SceneState, env: Env, maxRounds: number): { state: SceneState; next: Prompt | End } {
  let state = initial
  for (let i = 0; i < 500; i++) {
    const finished = over(state)
    if (finished) return { state, next: finished }

    const open = getOpenAction(state)
    if (open) {
      if (open.step === 'define') {
        if (open.spawnedBy && state.characters[open.actorId] && FOLLOW_UPS.includes(open.kind)) {
          const who = open.actorId
          return { state, next: { kind: 'prompt', side: sideOf(who), title: `${getFightName(state, who)} may follow up: ${getActionPanel(state).open?.label ?? open.kind}.`, choices: followUpChoices(state, who, open) } }
        }
        const settled = open.spawnedBy ? passUp(state, open, env.newId) : null
        if (!settled || settled === state) return { state, next: { kind: 'end', text: 'Stuck: an action was left half-declared.' } }
        state = settled
        continue
      }
      if (open.step === 'react') {
        const reactor = SIDES.map((side) => IDS[side]).find((who) => state.characters[who] && !getLiveReactionsTo(state, open.id).some((r) => r.actorId === who) && getAvailableActions(state, who).some((o) => o.available))
        if (reactor) {
          return { state, next: { kind: 'prompt', side: sideOf(reactor), title: `${getFightName(state, reactor)} may answer. ${threat(state)}`, choices: defenseChoices(state, reactor, env) } }
        }
        const rolled = rollOrPay(env.dice, env.newId)(state)
        if (rolled === state) return { state, next: { kind: 'end', text: 'Stuck: the open action cannot be rolled.' } }
        state = rolled
        continue
      }
      if (open.step === 'post') {
        const buying = hopPrompt(state, open)
        if (buying) return { state, next: buying }
        const landed = resolveAction(env.newId)(state)
        if (landed === state) return { state, next: { kind: 'end', text: 'Stuck: the open action cannot land.' } }
        state = landed
        continue
      }
      return { state, next: { kind: 'end', text: 'Stuck: an action is done but still open.' } }
    }

    const holder = getTurnHolder(state)
    if (holder) {
      return { state, next: { kind: 'prompt', side: sideOf(holder), title: `${getFightName(state, holder)}'s turn.`, choices: turnChoices(state, holder, env), note: [aimNote(state, holder, getLiveFoes(state, partyOf(holder)), env), threatNote(state, holder, getLiveFoes(state, partyOf(holder)))].filter(Boolean).join('\n\n') || undefined } }
    }

    const called = state.morale.find((call) => call.roll === null && state.characters[call.id])
    if (called) return { state, next: { kind: 'prompt', side: sideOf(called.id), title: moraleTitle(state, called.id), choices: moraleChoices(state, called.id) } }

    const holding = getConcentrationOwed(state)[0]
    if (holding) { state = getHoldOnBar(state, holding) ? letGo(holding, env.dice)(state) : holdOn(holding, env.dice)(state); continue }
    if (getRoundPhase(state)) {
      const moved = continueRound(env.dice)(state)
      if (moved === state) return { state, next: { kind: 'end', text: `Stalled: ${getContinueBar(state)}.` } }
      state = moved
      continue
    }

    const started = startNextTurn(state, env)
    if (started) { state = started; continue }

    const idle = SIDES.map((side) => IDS[side]).find((id) => state.characters[id] && !hasAgreedToEnd(state, id))
    if (idle) { state = toggleAgreeToEnd(idle)(state); continue }

    const bar = getNextRoundBar(state)
    if (bar !== null) return { state, next: { kind: 'end', text: `Stalled: ${bar}.` } }
    if (state.round + 1 >= maxRounds) return { state, next: { kind: 'end', text: `Draw: still standing after round ${maxRounds}.` } }
    state = nextRound(env.dice)(state)
  }
  return { state, next: { kind: 'end', text: 'Stuck: too many steps without a decision.' } }
}

function previewOf(state: SceneState): string {
  const lines = getActionPanel(state).outcomes.map(({ target, outcome }) => {
    if (outcome.stopped) return `${target}: intercepted`
    const wound = outcome.wound ? `, WOUND ${outcome.wound.name}` : ''
    const result = outcome.tier === null ? 'no injury' : `tier ${outcome.tier}, IL +${outcome.IL}${outcome.bleed ? `, bleed +${outcome.bleed}` : ''}${wound}${outcome.interruption !== 'none' ? `, ${outcome.interruption}` : ''}${outcome.dead ? ', DEAD' : ''}`
    return `${target}: ${outcome.damage} ${outcome.type} damage vs armor ${outcome.armor} -> ${result}`
  })
  return lines.join('; ') || 'no effect'
}

// A hit with overflow left (combat.tex "Success Overflow"): the attacker may
// buy effects with it before the blow lands, each priced and gated by the rules.
function hopPrompt(state: SceneState, open: RootAction): Prompt | null {
  if ((open.kind !== 'strike' && open.kind !== 'shoot') || !open.targetId || !state.characters[open.targetId] || !state.characters[open.actorId]) return null
  const target = state.characters[open.targetId]
  const options = getHOPOptions(state, open)
  const bought = options.filter((o) => o.bought > 0)
  const grapple = open.kind === 'strike' && canGrapple(state, open) ? open : null
  if ((options.length === 0 || (!options.some((o) => o.available) && bought.length === 0)) && !grapple) return null
  const remaining = getHOPRemaining(open, target)
  const spend = options.map((o): Choice => {
    const next = spendHOP(o.purchase)(state)
    const price = o.price && (o.price.AP || o.price.STA) ? `, and ${o.price.AP} AP ${o.price.STA} STA` : ''
    return {
      label: `BUY ${HOP_LABELS[o.purchase]}: ${o.cost} HOP${price}${o.bought > 0 ? ` (bought ${o.bought} already)` : ''}${next === state ? '' : ` -> then: ${previewOf(next)}`}`,
      apply: () => (next === state ? null : next),
      ...(o.available && next !== state ? {} : { unavailable: o.reason ?? 'closed' }),
    }
  })
  const back = bought.map((o): Choice => ({ label: `TAKE BACK ${HOP_LABELS[o.purchase]}`, apply: () => { const undone = refundHOP(o.purchase)(state); return undone === state ? null : undone } }))
  return {
    kind: 'prompt',
    side: sideOf(open.actorId),
    title: `${getFightName(state, open.actorId)} hit, with ${remaining} HOP left to spend (hit overflow). As it stands the blow does: ${previewOf(state)}.`,
    choices: [{ label: 'LAND THE BLOW as it stands', apply: (e) => { const landed = resolveAction(e.newId)(state); return landed === state ? null : landed } }, ...spend, ...back,
      ...(grapple ? [{ label: grapple.grapples ? 'DO NOT GRAPPLE the target' : 'GRAPPLE the target (free)', apply: () => chooseGrapple(!grapple.grapples)(state) } satisfies Choice] : [])],
  }
}

function moraleTitle(state: SceneState, id: string): string {
  const test = getMoraleTest(state, id)
  return `${getFightName(state, id)} is called to a morale test (will ${test?.skill} against DL ${test?.DL}); a graze leaves them afraid; a miss leaves them afraid and, with a foe near, activates their limit stress action if they have one.`
}

function moraleChoices(state: SceneState, id: string): Choice[] {
  return (['normal', 'safe', 'risky'] as const).map((mode) => ({
    label: `roll the morale test ${mode === 'normal' ? 'normally' : mode === 'safe' ? 'safely (keep the die closest to 5)' : 'riskily (keep the die farthest from 5)'}`,
    apply: (e) => { const rolled = rollMorale(id, mode, true, e.dice)(state); return rolled === state ? null : rolled },
  }))
}

// The next turn: the side after the one whose action landed last is asked first
// (play.tex "Combat": "first to ask, first to play"); at the start, the die says.
function startNextTurn(state: SceneState, env: Env): SceneState | null {
  const history = getHistory(state)
  const lastId = history.at(-1)
  const lastActor = lastId ? getAction(state, lastId)?.actorId : undefined
  const first = lastActor ? (SIDES.indexOf(sideOf(lastActor)) + 1) % 2 : history.length === 0 ? env.dice(false) % 2 : 0
  for (const side of [SIDES[first], SIDES[(first + 1) % 2]]) {
    const id = IDS[side]
    if (!state.characters[id] || hasAgreedToEnd(state, id) || getLiveFoes(state, partyOf(id)).length === 0) continue
    const turn = startTurn(id)(state)
    if (turn !== state) return turn
  }
  return null
}

const costText = (c: ActionCost | null) => (c ? `${c.AP} AP${c.STA ? ` ${c.STA} STA` : ''}` : '')
const rollText = (r: ActionRoll | null) => (r ? `d10 ${r.die}, score ${r.score} vs DL ${r.DL}: ${r.degree.toUpperCase()}` : '')
const priceText = (t: CostTerm[]) => t.map((x) => `${x.label} ${x.AP} AP${x.STA ? ` ${x.STA} STA` : ''}`).join(', ')

function breakdown(indent: string, price: CostTerm[], roll: ActionRoll | null, surged: EpisodeEntry['surged'], changes: string[]): string[] {
  return [
    ...(surged ? [`${indent}${surged.kind} surge first: -${surged.STA} STA, +${surged.AP} AP`] : []),
    ...(price.length > 0 ? [`${indent}price: ${priceText(price)}`] : []),
    ...(roll && roll.skillTerms.length > 0 ? [`${indent}skill: ${terms(roll.skillTerms)}`] : []),
    ...(roll && roll.DLTerms.length > 0 ? [`${indent}DL: ${terms(roll.DLTerms)}`] : []),
    ...changes.map((c) => `${indent}changed: ${c}`),
  ]
}

// The app's own report of what the last action came to, as text.
function renderEntry(entry: EpisodeEntry): string[] {
  const lines = [
    `${entry.actor} | ${entry.label} | ${costText(entry.cost)} | ${rollText(entry.roll)}${entry.cause ? ` | ${entry.cause}` : ''}`,
    ...breakdown('    ', entry.costTerms, entry.roll, entry.surged, entry.changes),
  ]
  for (const r of entry.reactions) {
    lines.push(`    ${r.actor} answered: ${r.label} | ${costText(r.cost)} | ${rollText(r.roll)}`, ...breakdown('        ', r.costTerms, r.roll, r.surged, r.changes))
  }
  for (const w of entry.withdrawn) lines.push(`    ${w.text}`)
  if (entry.fate) lines.push(`    ${entry.fate}`)
  for (const { target, outcome, steps } of entry.outcomes) {
    if (outcome.stopped) { lines.push(`    ${target}: intercepted`); continue }
    const wound = outcome.wound ? `, WOUND ${outcome.wound.name}${outcome.wound.part ? ` (${outcome.wound.part.name})` : ''}` : ''
    const tier = outcome.tier === null ? 'no injury' : `tier ${outcome.tier}${outcome.bodyTier !== outcome.tier ? ` (body tier ${outcome.bodyTier})` : ''}, IL +${outcome.IL}${outcome.bleed ? `, bleed +${outcome.bleed}` : ''}${wound}${outcome.interruption !== 'none' ? `, ${outcome.interruption}${outcome.apLoss ? ` -${outcome.apLoss} AP` : ''}` : ''}${outcome.dead ? ', DEAD' : ''}`
    lines.push(`    ${target}: ${outcome.damage} ${outcome.type} damage vs armor ${outcome.armor} -> ${tier}`, ...steps.map((st) => `        ${st.text} [${st.rule}]`))
  }
  for (const n of entry.notes) lines.push(`    ${n.target}: ${n.text}`)
  return lines
}

function newEvents(before: SceneState, after: SceneState, lastKey: string): { events: string[]; lastKey: string } {
  const morale = after.morale.flatMap((call) => call.roll && !before.morale.some((m) => m.id === call.id && m.roll)
    ? `round ${after.round + 1} | ${getFightName(after, call.id)} | morale test (${call.roll.mode}): d10 ${call.roll.die}, score ${call.roll.score} vs DL ${call.roll.DL}: ${call.roll.degree.toUpperCase()}`
    : [])
  const key = getHistory(after).at(-1) ?? ''
  const episode = key !== lastKey ? getLastEpisode(after) : null
  const played = episode ? [`--- round ${after.round + 1}`, ...episode.flatMap(renderEntry)] : []
  return { events: [...morale, ...played], lastKey: key }
}

function status(state: SceneState, side: Side): string {
  const id = IDS[side]
  const c = state.characters[id]
  const hurt = c.injuries.wounds.map((w) => `${w.name} (${w.part})`)
  const afflictions = getAfflictions(c)
  const held = c.held.map((i) => i.name).join(' + ') || 'bare hands'
  return `${getFightName(state, id)} (side ${side}): ${held}, wearing ${c.worn?.name ?? 'no armor'} | AP ${c.resources.AP}${getSurgeAPLeft(c) > 0 ? ` (${getSurgeAPLeft(c)} of it surge AP, spendable only on what the surge allows)` : ''}, STA ${c.resources.STA} | injury level ${c.injuries.injuryLevel}/50 (-${getInjuryPenalty(c)} to tests; dead at 50)${isDead(c) ? ' DEAD' : ''}${hurt.length > 0 ? ` | wounds: ${hurt.join(', ')}` : ''}${afflictions.length > 0 ? ` | ${afflictions.join(', ')}` : ''}`
}

function render(saved: Saved, next: Prompt | End, played?: string[]): string {
  const { state } = saved
  const gap = gapBetween(state, IDS.A, IDS.B)
  const lines = [
    `Round ${state.round + 1} | ${gap === null ? '' : `the fighters stand ${gap} cell${gap === 1 ? '' : 's'} apart`}`,
    status(state, 'A'),
    status(state, 'B'),
    '',
  ]
  const start = saved.events.map((e, i) => (e.startsWith('--- ') ? i : -1)).filter((i) => i >= 0).at(-1) ?? Math.max(0, saved.events.length - 1)
  const recent = played ?? saved.events.slice(start)
  if (recent.length > 0) lines.push(played ? 'What just happened:' : 'Last thing that happened:', ...recent.map((e) => `  ${e}`), '')
  if (next.kind === 'end') return [...lines, `THE FIGHT IS OVER. ${next.text}`].join('\n')
  return [...lines, `SIDE ${next.side} TO ACT. ${next.title}`, ...next.choices.map((c, i) => `  ${i + 1}. ${c.unavailable ? `(unavailable: ${c.unavailable}) ` : ''}${c.label}`), '', ...(next.note ? [next.note, ''] : []), 'Take one with: pnpm duel do <number> [--expect "text from its label"] [--aim <place>]. Numbers hold while this turn lasts, but show again after every move or attack. Dice are 0-9: on a normal test a 9 explodes upward and a 0 downward, so "d10 0" is a real 0, not a 10.'].join('\n')
}

function file(game: string): string {
  return path.join(DIR, `${game}.json`)
}

function load(game: string): Saved {
  if (!existsSync(file(game))) throw new Error(`No game "${game}". Start one with: pnpm duel new <A> <B>`)
  const raw = JSON.parse(readFileSync(file(game), 'utf-8')) as Saved
  return { ...raw, state: SceneStateSchema.parse(raw.state) }
}

function save(game: string, saved: Saved): void {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(file(game), JSON.stringify({ ...saved, evaluations: session.evaluations }))
}

function flag(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

function positional(args: string[]): string[] {
  return args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
}

const say = (text: string): void => console.log(text.replace(/[\u2014\u2212]/g, '-').replace(/\u2192/g, '->').replace(/\u00b7/g, '|'))

function main(): void {
  const [command, ...args] = process.argv.slice(2)
  const game = flag(args, 'game', 'duel')

  if (command === 'new') {
    const [a, b] = positional(args)
    if (!a || !b) throw new Error('usage: pnpm duel new "<Character>:<Weapon>[+<Offhand>]" "<Character>:<Weapon>" [--seed n] [--distance n] [--rounds n] [--game name]')
    session.evaluations = {}
    session.ahead = args.includes('--ahead')
    const created = create(a, b, Number(flag(args, 'seed', '1')), Number(flag(args, 'distance', '4')), Number(flag(args, 'rounds', '12')))
    const env = makeEnv(created)
    const { state, next } = advance(created.state, env, created.maxRounds)
    const saved = { ...created, ...env.counters(), state }
    save(game, saved)
    say(render(saved, next))
    return
  }

  const saved = load(game)
  session.evaluations = saved.evaluations ?? {}
  session.ahead = args.includes('--ahead')
  const env = makeEnv(saved)
  const { state, next } = advance(saved.state, env, saved.maxRounds)

  if (command === 'show') {
    say(render({ ...saved, state }, next))
    return
  }

  if (command === 'log') {
    say(saved.events.join('\n'))
    return
  }

  if (command === 'do') {
    const n = Number(positional(args)[0])
    if (next.kind === 'end') { say(render({ ...saved, state }, next)); return }
    const choice = next.choices[n - 1]
    if (!choice) throw new Error(`No choice ${n}: there are ${next.choices.length}`)
    const expect = flag(args, 'expect', '')
    if (expect && !choice.label.toLowerCase().includes(expect.toLowerCase())) throw new Error(`Choice ${n} is "${choice.label}", which does not contain "${expect}". Nothing was done; run show.`)
    if (choice.unavailable) throw new Error(`Choice ${n} is unavailable: ${choice.unavailable}`)
    const applied = choice.apply(env, flag(args, 'aim', '') || undefined)
    if (!applied) throw new Error(`Choice ${n} was refused by the rules`)
    const after = advance(applied, env, saved.maxRounds)
    const played = newEvents(state, after.state, saved.lastKey)
    const sameSideAgain = choice.label.startsWith('END TURN') && after.next.kind === 'prompt' && next.kind === 'prompt' && after.next.side === next.side && after.next.title.includes('turn.')
    const events = [...played.events, ...(sameSideAgain ? ['The turn ended, but the other side has nothing left to do this round, so a new turn starts for the same side. PASS stops acting for the round.'] : [])]
    const updated: Saved = { ...saved, ...env.counters(), state: after.state, events: [...saved.events, ...events], lastKey: played.lastKey }
    save(game, updated)
    say(render(updated, after.next, events.length > 0 ? events : ['(nothing was rolled or resolved)']))
    return
  }

  throw new Error('usage: pnpm duel new | show | do <n> | log')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
