import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CombatStateSchema, type CombatState, type Coord, type RootAction } from '../app/domain/combat/types'
import { rollD10, seededRng, type Dice } from '../app/domain/combat/dice'
import { buildFighter } from './lib/fighters'
import type { CampaignCharacter } from '../app/domain/types'
import { addCharacterToCombat } from '../app/domain/combat/factories'
import { setDistance } from '../app/domain/combat/geometry'
import { board } from '../app/domain/bot/fixtures'
import { getArmedAttacks, getAttackRows } from '../app/domain/bot/weapons'
import { estimateAttacks } from '../app/domain/bot/estimate'
import { getStrikeDefenses } from '../app/domain/bot/defenses'
import { declareDefense, getDefenseOptions } from '../app/domain/bot/answer'
import { hold } from '../app/domain/bot/engine'
import { passUp } from '../app/domain/bot/table'
import { getLiveFoes, isStanding, type Party } from '../app/domain/bot/party'
import { getReachableCells } from '../app/domain/combat/rules/move'
import { amendAction, commitAction, declareAction, resolveAction, rollOrPay, setTarget } from '../app/domain/combat/commands/action'
import { endTurn, startTurn, toggleAgreeToEnd } from '../app/domain/combat/commands/turn'
import { nextRound } from '../app/domain/combat/commands/nextRound'
import { canAnswer, getAction, getHistory, getLiveReactionsTo, getOpenAction } from '../app/domain/combat/rules/log'
import { getNextRoundBar, getTurnHolder, hasAgreedToEnd } from '../app/domain/combat/rules/turn'
import { getMoraleTest } from '../app/domain/combat/rules/morale'
import { rollMorale } from '../app/domain/combat/commands/morale'
import { getFightName } from '../app/domain/combat/rules/fighters'
import { getLastEpisode, type EpisodeEntry } from '../app/domain/combat/projections/episode'
import type { ActionRoll, CostTerm } from '../app/domain/combat/types'
import type { ActionCost } from '../app/domain/character/rules/actionCosts'
import { getActionPanel } from '../app/domain/combat/projections/actionPanel'
import { getOptionLabel } from '../app/domain/combat/projections/labels'
import { getAfflictions, getInjuryPenalty, isDead } from '../app/domain/character/rules/afflictions'

// A two-sided fight played by hand, one decision at a time, for an agent or a
// person to play from a strategy file. The state lives in a JSON file between
// calls; what a side may do is read off the same rules the panel reads, and
// whatever nobody owes a decision on (dice, landing, the round turning) is
// done for them.
//
//   pnpm duel new "Human Warrior:Longsword" "Human Warrior:Halberd" [--seed n] [--distance n] [--rounds n] [--game name]
//   pnpm duel show [--game name]      what the side to act sees
//   pnpm duel do <n> [--game name]    take choice n
//   pnpm duel log [--game name]       every action so far

type Side = 'A' | 'B'
const SIDES: readonly Side[] = ['A', 'B']
const IDS: Record<Side, string> = { A: 'a', B: 'b' }
const PARTIES: Party[] = [{ members: ['a'] }, { members: ['b'] }]

type Saved = {
  state: CombatState
  specs: Record<Side, string>
  seed: number
  draws: number
  ids: number
  maxRounds: number
  events: string[]
  lastKey: string
}

type Env = { dice: Dice; newId: () => string; counters: () => { draws: number; ids: number } }

type Choice = { label: string; apply: (env: Env) => CombatState | null; unavailable?: string }
type Prompt = { kind: 'prompt'; side: Side; title: string; choices: Choice[] }
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
    const added = addCharacterToCombat(buildFighter(IDS[side], spec, side), Object.fromEntries(characters.map((c) => [c.id, c])), env.newId)
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

function cellOf(state: CombatState, id: string): Coord | null {
  return state.board?.placements[id]?.cell ?? null
}

function gapBetween(state: CombatState, a: string, b: string): number | null {
  const ca = cellOf(state, a)
  const cb = cellOf(state, b)
  return ca && cb ? setDistance([ca], [cb]) : null
}

function isCommitted(state: CombatState, id: string): boolean {
  const action = getAction(state, id)
  return action !== null && action.step !== 'define'
}

// What the holder of the turn may do: each attack row and variation at each foe
// in reach, each place worth walking to, end the turn, or pass for the round.
function turnChoices(state: CombatState, id: string, env: Env): Choice[] {
  const party = partyOf(id)
  const foes = getLiveFoes(state, party)
  const estimates = new Map(foes.map((f) => [f, estimateAttacks(state, id, f)]))
  const armedNow = getArmedAttacks(state, id, 'strike', env.newId)
  const mine = state.characters[id]
  const attacks = getAttackRows(state, id, 'strike').flatMap((option) =>
    foes.map((target): Choice => {
      const armed = armedNow.find((a) => a.option.weapon === option.weapon && a.option.attack === option.attack && a.option.variant === option.variant)
      const guess = estimates.get(target)?.find((e) => e.attack === option.attack && e.variant === option.variant && e.weapon === option.weapon)
      const expected = guess ? `; estimate vs best answer (${guess.guarded.label}): hit ${(guess.guarded.pHit * 100).toFixed(0)}%, graze ${(guess.guarded.pGraze * 100).toFixed(0)}%, expected injury ${guess.expectedIL.toFixed(2)} for ${guess.totalCost.AP.toFixed(1)} AP ${guess.totalCost.STA.toFixed(1)} STA (${guess.ilPerCost.toFixed(2)} per cost, breakage not counted)` : ''
      const label = `attack with ${option.weapon} ${option.attack} (${option.variant}) at ${getFightName(state, target)} - ${option.AP} AP, ${option.STA} STA, weapon cut ${option.cut} blunt ${option.blunt}, to-hit penalty ${option.penalty}${expected}`
      if (!armed) {
        const short = mine.resources.AP < option.AP || mine.resources.STA < option.STA
        return { label, apply: () => null, unavailable: short ? `needs ${option.AP} AP and ${option.STA} STA, you have ${mine.resources.AP} AP and ${mine.resources.STA} STA` : 'not allowed now (for instance a turn on the movement surge allows only movement)' }
      }
      return {
        label,
        apply: (e) => {
          const committed = commitAction(e.dice, e.newId)(setTarget(target)(armed.state))
          return isCommitted(committed, armed.openId) ? committed : null
        },
        ...(armed.targets.includes(target) ? {} : { unavailable: 'the foe is out of reach' }),
      }
    }))

  const origin = cellOf(state, id)
  const foeCells = foes.flatMap((f) => cellOf(state, f) ?? [])
  const moves: Choice[] = []
  if (origin && foeCells.length > 0) {
    const here = setDistance([origin], foeCells)
    const declared = declareAction(id, { kind: 'move' }, env.newId)(state)
    const open = getOpenAction(declared)
    if (open?.kind === 'move') {
      for (const movement of ['basic', 'run'] as const) {
        const moving = amendAction({ movement })(declared)
        const aimed = getOpenAction(moving)
        if (aimed?.kind !== 'move') continue
        const byGap = new Map<number, ReturnType<typeof getReachableCells>[number]>()
        for (const to of getReachableCells(moving, aimed)) {
          const gap = setDistance([to.cell], foeCells)
          if (gap === here || gap > here + 3) continue
          const best = byGap.get(gap)
          if (!best || to.steps < best.steps) byGap.set(gap, to)
        }
        for (const [gap, to] of [...byGap].sort((a, b) => a[0] - b[0])) {
          moves.push({
            label: `move (${movement}) to ${gap} cell${gap === 1 ? '' : 's'} from the foe — ${to.steps} step${to.steps === 1 ? '' : 's'}, ${to.cost.AP} AP, ${to.cost.STA} STA`,
            apply: (e) => {
              const committed = commitAction(e.dice, e.newId)(amendAction({ movement, path: to.path })(declared))
              return isCommitted(committed, open.id) ? committed : null
            },
          })
        }
      }
    }
  }

  const probe: Env = { dice: () => 5, newId: (() => { let n = 0; return () => `probe${++n}` })(), counters: env.counters }
  return [
    { label: 'END TURN (the other side may act. If it has nothing left to do you are asked to start another turn; PASS is what stops you acting for the round)', apply: () => { const ended = endTurn(state); return ended === state ? null : ended } },
    { label: 'PASS for the rest of the round, keeping the AP you have left to defend with', apply: () => hold(state, id) },
    ...[...attacks, ...moves].map((c): Choice => (c.unavailable || c.apply(probe) !== null ? c : { ...c, unavailable: 'cannot be done now (not enough AP or STA, or not allowed)' })),
  ]
}

// What the target of a committed attack may answer it with, bar taking it: the
// bot's reflexes, and for a strike or a shot what the panel offers beyond them
// (an intercept, an evasive jump to each distance from the attacker it can land at).
function defenseOffers(state: CombatState, id: string, open: RootAction): Choice[] {
  const reflexes = getDefenseOptions(state, id, open).map((o): Choice => ({
    label: `${getOptionLabel(state, id, o)} — ${o.cost?.AP ?? 0} AP, ${o.cost?.STA ?? 0} STA`,
    apply: (e) => declareDefense(state, id, open, o, e.newId),
  }))
  const answerable = open.targetId === id && canAnswer(open, id) && !getLiveReactionsTo(state, open.id).some((r) => r.actorId === id)
  if ((open.kind !== 'strike' && open.kind !== 'shoot') || !answerable) return reflexes
  const from = cellOf(state, open.actorId)
  const landings = new Set<number>()
  const extra = getStrikeDefenses(state, id, open.actorId).filter((d) => {
    if (d.kind === 'intercept') return true
    if (d.kind !== 'evasiveJump' || !d.landing || !from) return false
    const gap = setDistance([d.landing.cell], [from])
    if (landings.has(gap)) return false
    landings.add(gap)
    return true
  }).map((d): Choice => ({
    label: `${d.kind === 'evasiveJump' && d.landing && from ? `evasive jump, landing ${setDistance([d.landing.cell], [from])} cell${setDistance([d.landing.cell], [from]) === 1 ? '' : 's'} from the attacker` : d.label} — ${d.cost.AP} AP, ${d.cost.STA} STA`,
    apply: (e) => d.declare(state, open, e.newId),
  }))
  return [...reflexes, ...extra]
}

function defenseChoices(state: CombatState, id: string): Choice[] {
  const open = getOpenAction(state)
  if (!open) return []
  return [{ label: 'NO DEFENSE: take the attack', apply: (e) => rollOrPay(e.dice, e.newId)(state) }, ...defenseOffers(state, id, open)]
}

function terms(list: readonly { label: string; value: number }[]): string {
  return list.map((t) => `${t.label} ${t.value >= 0 ? '+' : ''}${t.value}`).join(', ')
}

function threat(state: CombatState): string {
  const o = getActionPanel(state).open
  if (!o) return ''
  const place = o.location === 'chest' ? '' : `, aimed at the ${o.location}`
  return `${o.actor} attacks with ${o.attack} (${o.variant})${place}. The attacker's skill is ${o.score.total} (${terms(o.score.terms)}); add a d10 against a DL of ${o.DL.total} (${terms(o.DL.terms)}) before any defense.`
}

function over(state: CombatState): End | null {
  const standing = SIDES.filter((s) => isStanding(state, IDS[s]) && !state.surrendered.includes(IDS[s]))
  if (standing.length === 2) return null
  if (standing.length === 0) return { kind: 'end', text: 'Both sides have fallen.' }
  return { kind: 'end', text: `Side ${standing[0]} wins: ${getFightName(state, IDS[standing[0]])} is the last one standing.` }
}

// Plays what nobody owes a decision on, up to the next decision or the end.
function advance(initial: CombatState, env: Env, maxRounds: number): { state: CombatState; next: Prompt | End } {
  let state = initial
  for (let i = 0; i < 500; i++) {
    const finished = over(state)
    if (finished) return { state, next: finished }

    const open = getOpenAction(state)
    if (open) {
      if (open.step === 'define') {
        if (open.kind === 'fleeFollowUp') {
          const fleer = open.actorId
          return { state, next: { kind: 'prompt', side: sideOf(fleer), title: `${getFightName(state, fleer)} has just been struck at. They may flee (combat.tex "Flee"): the movement surge turns their turn into one limited to what that surge allows, and the attacker's turn resumes after it.`, choices: fleeChoices(state, open) } }
        }
        const settled = open.spawnedBy ? passUp(state, open, env.newId) : null
        if (!settled || settled === state) return { state, next: { kind: 'end', text: 'Stuck: an action was left half-declared.' } }
        state = settled
        continue
      }
      if (open.step === 'react') {
        const target = open.targetId
        if (target && state.characters[target] && defenseOffers(state, target, open).length > 0) {
          return { state, next: { kind: 'prompt', side: sideOf(target), title: `${getFightName(state, target)} is attacked. ${threat(state)}`, choices: defenseChoices(state, target) } }
        }
        const rolled = rollOrPay(env.dice, env.newId)(state)
        if (rolled === state) return { state, next: { kind: 'end', text: 'Stuck: the open action cannot be rolled.' } }
        state = rolled
        continue
      }
      if (open.step === 'post') {
        const landed = resolveAction(env.newId)(state)
        if (landed === state) return { state, next: { kind: 'end', text: 'Stuck: the open action cannot land.' } }
        state = landed
        continue
      }
      return { state, next: { kind: 'end', text: 'Stuck: an action is done but still open.' } }
    }

    const holder = getTurnHolder(state)
    if (holder) {
      return { state, next: { kind: 'prompt', side: sideOf(holder), title: `${getFightName(state, holder)}'s turn.`, choices: turnChoices(state, holder, env) } }
    }

    const called = state.morale.find((call) => call.roll === null && state.characters[call.id])
    if (called) return { state, next: { kind: 'prompt', side: sideOf(called.id), title: moraleTitle(state, called.id), choices: moraleChoices(state, called.id) } }

    const started = startNextTurn(state, env)
    if (started) { state = started; continue }

    const idle = SIDES.map((side) => IDS[side]).find((id) => state.characters[id] && !hasAgreedToEnd(state, id))
    if (idle) { state = toggleAgreeToEnd(idle)(state); continue }

    const bar = getNextRoundBar(state)
    if (bar !== null) return { state, next: { kind: 'end', text: `Stalled: ${bar}.` } }
    if (state.round + 1 >= maxRounds) return { state, next: { kind: 'end', text: `Draw: still standing after round ${maxRounds}.` } }
    state = nextRound(env.dice, env.newId)(state)
  }
  return { state, next: { kind: 'end', text: 'Stuck: too many steps without a decision.' } }
}

function fleeChoices(state: CombatState, open: RootAction): Choice[] {
  return [
    { label: 'STAY: do not flee', apply: (e) => passUp(state, open, e.newId) },
    {
      label: 'FLEE: activate the movement surge and take a turn limited to movement',
      apply: (e) => {
        const committed = commitAction(e.dice, e.newId)(amendAction({ flee: true })(state))
        return committed === state ? null : committed
      },
    },
  ]
}

function moraleTitle(state: CombatState, id: string): string {
  const test = getMoraleTest(state, id)
  return `${getFightName(state, id)} is called to a morale test (will ${test?.skill} against DL ${test?.DL}); a graze leaves them afraid; a miss leaves them afraid and, with a foe near, activates their limit stress action if they have one.`
}

function moraleChoices(state: CombatState, id: string): Choice[] {
  return (['normal', 'safe', 'risky'] as const).map((mode) => ({
    label: `roll the morale test ${mode === 'normal' ? 'normally' : mode === 'safe' ? 'safely (keep the die closest to 5)' : 'riskily (keep the die farthest from 5)'}`,
    apply: (e) => { const rolled = rollMorale(id, mode, true, e.dice)(state); return rolled === state ? null : rolled },
  }))
}

// The next turn: the side after the one whose action landed last is asked first
// (play.tex "Combat": "first to ask, first to play"); at the start, the die says.
function startNextTurn(state: CombatState, env: Env): CombatState | null {
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

function newEvents(before: CombatState, after: CombatState, lastKey: string): { events: string[]; lastKey: string } {
  const morale = after.morale.flatMap((call) => call.roll && !before.morale.some((m) => m.id === call.id && m.roll)
    ? `round ${after.round + 1} | ${getFightName(after, call.id)} | morale test (${call.roll.mode}): d10 ${call.roll.die}, score ${call.roll.score} vs DL ${call.roll.DL}: ${call.roll.degree.toUpperCase()}`
    : [])
  const key = getHistory(after).at(-1) ?? ''
  const episode = key !== lastKey ? getLastEpisode(after) : null
  const played = episode ? [`--- round ${after.round + 1}`, ...episode.flatMap(renderEntry)] : []
  return { events: [...morale, ...played], lastKey: key }
}

function status(state: CombatState, side: Side): string {
  const id = IDS[side]
  const c = state.characters[id]
  const hurt = c.injuries.wounds.map((w) => `${w.key} (${w.part})`)
  const afflictions = getAfflictions(c)
  const held = c.held.map((i) => i.name).join(' + ') || 'bare hands'
  return `${getFightName(state, id)} (side ${side}): ${held}, wearing ${c.worn?.name ?? 'no armor'} | AP ${c.resources.AP}${c.resources.surgeAP > 0 ? ` (+${c.resources.surgeAP} surge AP, spendable only on what the surge allows)` : ''}, STA ${c.resources.STA} | injury level ${c.injuries.injuryLevel}/50 (-${getInjuryPenalty(c)} to tests; dead at 50)${isDead(c) ? ' DEAD' : ''}${hurt.length > 0 ? ` | wounds: ${hurt.join(', ')}` : ''}${afflictions.length > 0 ? ` | ${afflictions.join(', ')}` : ''}`
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
  return [...lines, `SIDE ${next.side} TO ACT. ${next.title}`, ...next.choices.map((c, i) => `  ${i + 1}. ${c.unavailable ? `(unavailable: ${c.unavailable}) ` : ''}${c.label}`), '', 'Take one with: pnpm duel do <number> [--expect "text from its label"]. Numbers hold while this turn lasts, but show again after every move or attack. Dice are 0-9: on a normal test a 9 explodes upward and a 0 downward, so "d10 0" is a real 0, not a 10.'].join('\n')
}

function file(game: string): string {
  return path.join(DIR, `${game}.json`)
}

function load(game: string): Saved {
  if (!existsSync(file(game))) throw new Error(`No game "${game}". Start one with: pnpm duel new <A> <B>`)
  const raw = JSON.parse(readFileSync(file(game), 'utf-8')) as Saved
  return { ...raw, state: CombatStateSchema.parse(raw.state) }
}

function save(game: string, saved: Saved): void {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(file(game), JSON.stringify(saved))
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
    const created = create(a, b, Number(flag(args, 'seed', '1')), Number(flag(args, 'distance', '4')), Number(flag(args, 'rounds', '12')))
    const env = makeEnv(created)
    const { state, next } = advance(created.state, env, created.maxRounds)
    const saved = { ...created, ...env.counters(), state }
    save(game, saved)
    say(render(saved, next))
    return
  }

  const saved = load(game)
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
    const applied = choice.apply(env)
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
