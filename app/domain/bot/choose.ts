import type { CombatState, RootAction } from '../combat/types'
import { rollD10, seededRng, type Dice } from '../combat/dice'
import { getFightName } from '../combat/rules/fighters'
import { declareDefense, getDefenseOptions } from './answer'
import { getCandidates } from './candidates'
import { playOut, type Answerer } from './open'
import { getTuning, isMember, type Party } from './party'
import type { Trace } from './trace'
import { evaluate, type Value } from './value'

// Where a bot weighs its options: each is played out on a copy of the state
// with the same few dice, the state it leaves is valued (value.ts), and the
// best average wins. Ties go to the first listed, which is to do nothing.

type Option = { label: string; play: ((dice: Dice) => CombatState | null) | null }

function mean(values: Value[]): Value {
  const of = (part: keyof Value) => values.reduce((sum, v) => sum + v[part], 0) / values.length
  return { total: of('total'), wounds: of('wounds'), threat: of('threat'), engage: of('engage'), resources: of('resources') }
}

// An option's value to `actorId`'s party: played out with each of the sample
// dice, everyone but `decided` answering by reflex. Null when it does not
// come off. An option with no way to play is the state as it stands.
function score(state: CombatState, parties: readonly Party[], party: Party, actorId: string, option: Option, decided: readonly string[], newId: () => string): Value | null {
  const tuning = getTuning(party)
  if (!option.play) return evaluate(state, party, actorId, tuning, newId)
  const values: Value[] = []
  for (let k = 0; k < tuning.samples; k++) {
    const rng = seededRng(k + 1)
    const dice: Dice = (explodes) => rollD10(explodes, rng)
    const played = option.play(dice)
    if (!played) return null
    values.push(evaluate(playOut(played, parties, dice, newId, decided), party, actorId, tuning, newId))
  }
  return mean(values)
}

function pick(state: CombatState, parties: readonly Party[], party: Party, actorId: string, kind: 'turn' | 'answer', options: Option[], decided: readonly string[], newId: () => string, trace?: Trace): number {
  const scored = options.flatMap((option, index) => {
    const value = score(state, parties, party, actorId, option, decided, newId)
    return value ? [{ index, label: option.label, value }] : []
  })
  const best = scored.reduce((a, b) => (b.value.total > a.value.total ? b : a))
  trace?.({
    kind,
    actorId,
    actor: getFightName(state, actorId),
    options: scored.map(({ label, value }) => ({ label, value: value.total, wounds: value.wounds, threat: value.threat, engage: value.engage, resources: value.resources })),
    chosen: scored.indexOf(best),
  })
  return best.index
}

// What the character does with its turn: the state after the option it
// weighs best, or null to do nothing and keep what AP it has.
export function chooseTurnAction(state: CombatState, parties: readonly Party[], party: Party, id: string, dice: Dice, newId: () => string, trace?: Trace): CombatState | null {
  const candidates = getCandidates(state, party, id, newId)
  if (candidates.length === 0) return null
  const options: Option[] = [{ label: 'hold', play: null }, ...candidates]
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
