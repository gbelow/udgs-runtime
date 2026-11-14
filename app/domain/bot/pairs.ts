import type { CampaignCharacter } from '../types'
import { SceneStateSchema, type ActionDraft, type SceneState, type StrikeAction } from '../scene/types'
import type { ActionCost } from '../character/rules/actionCosts'
import type { Outcome } from '../character/rules/damage'
import type { RollMode } from '../play/dice'
import { toUpdater, type CommandContext, type SceneCommand } from '../scene/commands/registry'
import { getFreeAttackOptions, getRootTest, hasUnfocusedRow } from '../scene/rules/attack'
import { getAvailableActions } from '../scene/rules/options'
import { getOpenAction, getReactionsTo } from '../scene/rules/log'
import { getOwnCost } from '../scene/rules/action'
import { getRoundPhase } from '../scene/rules/roundChange'
import { getStrikeReach } from '../scene/rules/board/board'
import { getSTA } from '../character/rules/characteristics'
import { getTestMode } from '../character/rules/effects'
import { ROUND_AP } from '../tables'
import { declare } from './declare'
import { bestSpend, predict, type Supposed } from './predict'
import { getMostHOP, type HarmByDegree } from './odds'

// What one character's attacks do to another, each against each defence the
// other could answer with, read off the table's own rules: the two are put in
// a fight of their own with no board, both at a fresh round's AP and full STA,
// the attack declared and answered as a person would, and each degree it could
// come to landed as `predict` lands it (a hit's HOP spent by `bestSpend`).
// Where they stand plays no part (no cover, no high ground, no light), and a
// shot's distance penalty is left to the reader (`distanceRate`), so the table
// holds for any two places. Harm is 2 x IL + 3 x bleed (the user's ruling).
//
// A hit lands in full whatever the defence (combat.tex "Defend"), so a hit's
// harm is read once, undefended; a graze and a miss are read against each
// defence.

export type PairDefence = {
  // the reaction answered with as the panel offers it, or null for none (the SD)
  draft: ActionDraft | null
  cost: ActionCost
  DL: number
  graze: number
  miss: number
}

export type PairAttack = {
  kind: 'strike' | 'shoot'
  row: { weaponKey: string; attack: string; variant: string }
  cost: ActionCost
  // metres
  reach: number
  // the penalty a shot takes per step of distance (`getDistancePenalty`); null for a strike
  distanceRate: number | null
  // whether the row is open only once the focus surge is made
  needsFocus: boolean
  skill: number
  grazes: boolean
  mode: RollMode
  // harm on a hit at each HOP from 0
  hits: number[]
  defences: PairDefence[]
}

const TRIAL: CommandContext = { thrower: () => 0, newId: (() => { let n = 0; return () => `pair-${n++}` })() }
const press = (state: SceneState, command: SceneCommand) => toUpdater(command, TRIAL)(state)

export const getHarm = (o: Outcome | null | undefined): number => (o ? 2 * o.IL + 3 * o.bleed : 0)

const fresh = (c: CampaignCharacter): CampaignCharacter => ({ ...c, usedSurge: null, resources: { ...c.resources, AP: ROUND_AP, STA: getSTA(c) } })

// The fight of the two, the round begun and the attacker's turn taken.
function duel(attacker: CampaignCharacter, defender: CampaignCharacter): SceneState | null {
  let s = SceneStateSchema.parse({ characters: { [attacker.id]: fresh(attacker), [defender.id]: fresh(defender) }, parties: { a: {}, d: {} }, partyOf: { [attacker.id]: 'a', [defender.id]: 'd' } })
  s = press(s, { kind: 'nextRound', args: [] })
  for (let i = 0; i < 10 && getRoundPhase(s); i++) s = press(s, { kind: 'continueRound', args: [] })
  const started = press(s, { kind: 'startTurn', args: [attacker.id] })
  return started === s ? null : started
}

function harmAt(state: SceneState, roll: Supposed, defenderId: string, spend: boolean): number {
  if (spend) {
    const b = bestSpend(state, roll, [], TRIAL)
    return b.ok && b.best.prediction.ok ? getHarm(b.best.prediction.outcomes.find((o) => o.id === defenderId)?.outcome) : 0
  }
  const p = predict(state, roll, [], TRIAL)
  return p.ok ? getHarm(p.outcomes.find((o) => o.id === defenderId)?.outcome) : 0
}

function readPair(attacker: CampaignCharacter, defender: CampaignCharacter): PairAttack[] {
  const start = duel(attacker, defender)
  if (!start) return []
  const a = attacker.id
  const d = defender.id
  const focused = hasUnfocusedRow(start.characters[a], 'shoot', true) ? press(start, { kind: 'surge', args: [a, 'focus'] }) : start
  const open = new Set(getFreeAttackOptions(start, start.characters[a], 'shoot').map((o) => `${o.weaponKey}/${o.attack}/${o.variant}`))
  const attacks: PairAttack[] = []
  for (const kind of ['strike', 'shoot'] as const) {
    const from = kind === 'shoot' ? focused : start
    for (const option of getFreeAttackOptions(from, from.characters[a], kind)) {
      const row = { weaponKey: option.weaponKey, attack: option.attack, variant: option.variant }
      const made = declare(from, { actorId: a, option: { kind }, picks: [{ part: 'row', value: row }, { part: 'target', value: d }] }, TRIAL)
      if (!made.ok) continue
      const root = getOpenAction(made.state)
      if (!root || root.step !== 'react') continue
      const test = getRootTest(made.state, root)
      const cost = getOwnCost(made.state, root)
      if (!test || test.scale !== 'overflow' || !cost) continue
      const reach = kind === 'strike' ? getStrikeReach(made.state, root as StrikeAction) : option.reach
      if (reach === null) continue

      const answers = getAvailableActions(made.state, d).filter((o) => o.available && o.reactionTo === root.id)
      const defended: { draft: ActionDraft | null; state: SceneState; cost: ActionCost }[] = [{ draft: null, state: made.state, cost: { AP: 0, STA: 0 } }, ...answers.flatMap((o) => {
        const given = declare(made.state, { actorId: d, option: o.draft, picks: [] }, TRIAL)
        const reaction = given.ok ? getReactionsTo(given.state, root.id).find((r) => r.actorId === d) : undefined
        const price = reaction ? getOwnCost(given.state, reaction) : null
        return given.ok && price ? [{ draft: o.draft, state: given.state, cost: price }] : []
      })]
      const defences = defended.flatMap((def): PairDefence[] => {
        const t = getRootTest(def.state, getOpenAction(def.state)!)
        return t ? [{ draft: def.draft, cost: def.cost, DL: t.DL, graze: harmAt(def.state, { degree: 'graze' }, d, false), miss: harmAt(def.state, { degree: 'miss' }, d, false) }] : []
      })
      const most = getMostHOP(test.skill, Math.min(...defences.map((x) => x.DL)))
      const hits = Array.from({ length: Math.max(0, most + 1) }, (_, HOP) => harmAt(made.state, { degree: 'hit', HOP }, d, true))
      attacks.push({
        kind,
        row,
        cost,
        reach,
        distanceRate: kind === 'shoot' ? option.distance : null,
        needsFocus: kind === 'shoot' && !open.has(`${row.weaponKey}/${row.attack}/${row.variant}`),
        skill: test.skill,
        grazes: test.grazes,
        mode: getTestMode(attacker),
        hits,
        defences,
      })
    }
  }
  return attacks
}

// A sheet as the pair table reads it: who it is and what changes on every
// press (AP, STA, the surge made, the face's thirds) left out, so the table is
// read again only when something it rests on changes, and two copies of one
// sheet share it.
const signatures = new WeakMap<CampaignCharacter, string>()

function signature(c: CampaignCharacter): string {
  let sig = signatures.get(c)
  if (sig === undefined) {
    const { id, resources, usedSurge, shown, ...rest } = c
    void id
    void usedSurge
    void shown
    sig = JSON.stringify({ ...rest, resources: { ...resources, AP: 0, STA: 0 } })
    signatures.set(c, sig)
  }
  return sig
}

const pairs = new Map<string, PairAttack[]>()
const MOST_KEPT = 4000

export function getPair(attacker: CampaignCharacter, defender: CampaignCharacter): PairAttack[] {
  const key = `${signature(attacker)}\n${signature(defender)}`
  let known = pairs.get(key)
  if (!known) {
    if (pairs.size >= MOST_KEPT) pairs.clear()
    known = readPair(attacker, defender)
    pairs.set(key, known)
  }
  return known
}

export const harmOf = (attack: PairAttack, defence: PairDefence): HarmByDegree => ({ miss: defence.miss, graze: defence.graze, hits: attack.hits })
