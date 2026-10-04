import type { CombatState, RootAction } from '../combat/types'
import { rollD10, seededRng, type Dice } from '../combat/dice'
import { getFightName } from '../combat/rules/fighters'
import { getHistory, getLog } from '../combat/rules/log'
import { declareDefense, getDefenseOptions } from './answer'
import { getCandidates } from './candidates'
import { hold } from './engine'
import { getExchange } from './exchange'
import { playOut, type Answerer } from './open'
import { getTuning, isMember, type Party } from './party'
import { rollout } from './rollout'
import type { Trace } from './trace'
import { evaluate, type Value } from './value'

// Where a bot weighs its options: each is played out on a copy of the state
// with the same few dice and the fight played on from there (rollout.ts), the
// state it comes to is valued (value.ts), and the best average wins. Ties go
// to the first listed, which is to do nothing.

// `waiting` is what taking the option costs besides what comes of it.
type Option = { label: string; play: (dice: Dice) => CombatState | null; waiting?: number }

function mean(values: Value[]): Value {
  const of = (part: keyof Value) => values.reduce((sum, v) => sum + v[part], 0) / values.length
  return { total: of('total'), wounds: of('wounds'), threat: of('threat'), engage: of('engage'), resources: of('resources'), waiting: of('waiting'), exchange: of('exchange') }
}

// An option's value to `actorId`'s party: played out with each of the sample
// dice, everyone but `decided` answering by reflex, and the fight played on
// for the party's horizon. Null when it does not come off.
function score(parties: readonly Party[], party: Party, actorId: string, option: Option, decided: readonly string[], newId: () => string, seed: number): Value | null {
  const tuning = getTuning(party)
  const values: Value[] = []
  for (let k = 0; k < tuning.samples; k++) {
    const rng = seededRng(seed + k)
    const dice: Dice = (explodes) => rollD10(explodes, rng)
    const played = option.play(dice)
    if (!played) return null
    const exchange = getExchange(played, party, actorId, tuning, newId)
    const settled = playOut(played, parties, dice, newId, decided)
    const end = evaluate(tuning.horizon > 0 ? rollout(settled, parties, dice, newId, tuning.horizon) : settled, party, actorId, tuning, newId)
    values.push({ ...end, total: end.total + exchange - (option.waiting ?? 0), waiting: -(option.waiting ?? 0), exchange })
  }
  return mean(values)
}

// The dice an option is tried with differ from one decision to the next, and
// are the same for every option of one: they are made from where the fight
// stands, so that no run of dice colours every choice alike.
function getSampleSeed(state: CombatState, actorId: string): number {
  const named = [...actorId].reduce((hash, ch) => Math.imul(hash, 31) + ch.charCodeAt(0), 7)
  return (Math.imul(state.round, 1000003) + Math.imul(getLog(state).length, 7919) + Math.imul(getHistory(state).length, 31) + named) >>> 0
}

function pick(state: CombatState, parties: readonly Party[], party: Party, actorId: string, kind: 'turn' | 'answer', options: Option[], decided: readonly string[], newId: () => string, trace?: Trace): number {
  const scored = options.flatMap((option, index) => {
    const value = score(parties, party, actorId, option, decided, newId, getSampleSeed(state, actorId))
    return value ? [{ index, label: option.label, value }] : []
  })
  if (scored.length === 0) return -1
  const best = scored.reduce((a, b) => (b.value.total > a.value.total ? b : a))
  trace?.({
    kind,
    actorId,
    actor: getFightName(state, actorId),
    options: scored.map(({ label, value }) => ({ label, value: value.total, wounds: value.wounds, threat: value.threat, engage: value.engage, resources: value.resources, waiting: value.waiting, exchange: value.exchange })),
    chosen: scored.indexOf(best),
  })
  return best.index
}

// What the character does with its turn: the state after the option it
// weighs best, or null to do nothing and keep what AP it has.
export function chooseTurnAction(state: CombatState, parties: readonly Party[], party: Party, id: string, dice: Dice, newId: () => string, trace?: Trace): CombatState | null {
  const candidates = getCandidates(state, party, id, newId)
  if (candidates.length === 0) return null
  const options: Option[] = [{ label: 'hold', play: () => hold(state, id), waiting: getTuning(party).patience * (state.round - 1) }, ...candidates]
  return candidates[pick(state, parties, party, id, 'turn', options, [], newId, trace) - 1]?.play(dice) ?? null
}

// How a member of the party who may defend against the committed action
// answers it, or null when none does.
export function chooseAnswer(state: CombatState, parties: readonly Party[], party: Party, open: RootAction, newId: () => string, trace?: Trace): CombatState | null {
  if (isMember(party, open.actorId)) return null
  for (const id of party.members) {
    const declared = getDefenseOptions(state, id, open).flatMap((o) => {
      const next = declareDefense(state, id, open, o, newId)
      return next ? [{ label: `${o.draft.kind}${o.surge ? ' (surge)' : ''}`, state: next }] : []
    })
    if (declared.length === 0) continue
    const options: Option[] = [{ label: 'no defense', play: () => state }, ...declared.map((d) => ({ label: d.label, play: () => d.state }))]
    const chosen = pick(state, parties, party, id, 'answer', options, [id], newId, trace)
    if (chosen > 0) return declared[chosen - 1].state
  }
  return null
}

// How the parties answer: the first member of any who chooses to defend.
export function chooseAnyAnswer(trace?: Trace): Answerer {
  return (state, parties, open, newId) => {
    for (const party of parties) {
      const answered = chooseAnswer(state, parties, party, open, newId, trace)
      if (answered) return answered
    }
    return null
  }
}
