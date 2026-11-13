import type { SceneState, RootAction } from '../scene/types'
import type { Dice } from '../play/dice'
import { getFightName } from '../scene/rules/fighters'
import { getOpenAction } from '../scene/rules/log'
import { defend, getDefenseOptions } from './answer'
import { getOpportunities } from './opportunity'
import { getCandidates } from './candidates'
import { hold } from './engine'
import { getExchange, isAnswerable } from './exchange'
import { playOut, settleWith, type Answerer } from './open'
import { getTuning, isOnSide, type Party } from './party'
import { rollout } from './rollout'
import type { Trace } from './trace'
import { evaluate, type Value } from './value'
import { applyMove, type Played } from './move'
import { getBelief } from './belief'

// Where a bot weighs its options: each is played out on a copy of the state
// with the same two dice, the fight played on from there for the party's
// horizon (rollout.ts), the state it comes to is valued (value.ts), and the
// best average wins. Ties go
// to the first listed, which is to do nothing. What the believed fight offers
// may be refused at the real table, so the options are tried best first until
// one comes off, or doing nothing is reached.

type Option = { label: string; play: (dice: Dice) => SceneState | null }

function mean(values: Value[]): Value {
  const of = (part: keyof Value) => values.reduce((sum, v) => sum + v[part], 0) / values.length
  return { total: of('total'), wounds: of('wounds'), potential: of('potential'), immediate: of('immediate'), engage: of('engage'), resources: of('resources'), drained: of('drained'), exchange: of('exchange') }
}

// The dice every option is tried with: a middling and a high one, as the
// attacks are read (reading.ts).
const DICE = [4, 9]

// An option's value to `actorId`'s party: played out with each of the dice,
// everyone but `decided` answering by reflex, and the fight played on for the
// party's horizon. Null when it does not come off. What the option is worth as
// committed (exchange.ts) is read once: committing throws no die.
function score(start: SceneState, parties: readonly Party[], party: Party, actorId: string, option: Option, decided: readonly string[], newId: () => string): Value | null {
  const tuning = getTuning(party)
  const values: Value[] = []
  let exchange: number | null = null
  for (const die of DICE) {
    const dice: Dice = () => die
    const played = option.play(dice)
    if (!played) return null
    if (tuning.defensive > 0 && isAnswerable(played, party, actorId, tuning.defensive > 1, newId)) return null
    exchange ??= getExchange(played, parties, party, actorId, tuning, newId)
    const settled = playOut(played, parties, dice, newId, decided)
    const end = evaluate(tuning.horizon > 0 ? rollout(settled, parties, dice, newId, tuning.horizon) : settled, party, actorId, tuning, start)
    values.push({ ...end, total: end.total + exchange, exchange })
  }
  return mean(values)
}

// The first of the options, best first, that `take` takes, or -1 when it
// takes none of those above the first option. The first is doing nothing.
function pick(state: SceneState, parties: readonly Party[], party: Party, actorId: string, kind: 'turn' | 'answer', options: Option[], decided: readonly string[], newId: () => string, take: (index: number) => boolean, trace?: Trace): number {
  const scored = options.flatMap((option, index) => {
    const value = score(state, parties, party, actorId, option, decided, newId)
    return value ? [{ index, label: option.label, value }] : []
  })
  const ranked = scored.map((s, at) => ({ ...s, at })).sort((a, b) => b.value.total - a.value.total || a.at - b.at)
  const taken = ranked.find((s) => s.index === 0 || take(s.index))
  trace?.({
    kind,
    actorId,
    actor: getFightName(state, actorId),
    options: scored.map(({ label, value }) => ({ label, value: value.total, wounds: value.wounds, potential: value.potential, immediate: value.immediate, engage: value.engage, resources: value.resources, drained: value.drained, exchange: value.exchange })),
    chosen: taken ? taken.at : -1,
  })
  return taken && taken.index > 0 ? taken.index : -1
}

// Whether a move chosen on what the character believes is taken by the table
// as it really stands: it changes something, and leaves no action of the
// character's refused at its commit. A walk into a space someone unseen
// stands in is not.
function comesOff(real: SceneState, played: Played, id: string): boolean {
  let ids = 0
  const after = applyMove(real, played.move, () => 5, () => `check${++ids}`)
  const open = getOpenAction(after)
  return after !== real && !(open?.actorId === id && open.step === 'define')
}

// What the character does with its turn, weighed on the fight as it believes
// it to stand (belief.ts): the option it weighs best, or null to do nothing
// and keep what AP it has.
export function chooseTurnAction(state: SceneState, parties: readonly Party[], party: Party, id: string, dice: Dice, newId: () => string, trace?: Trace): Played | null {
  const believed = getBelief(state, party, id)
  const candidates = getCandidates(believed, party, id, newId)
  const options: Option[] = [
    { label: 'hold', play: () => hold(believed, id)?.state ?? null },
    ...candidates.map((c) => ({ label: c.label, play: (d: Dice) => c.play(d)?.state ?? null })),
  ]
  let chosen: Played | null = null
  pick(believed, parties, party, id, 'turn', options, [], newId, (index) => {
    const played = candidates[index - 1].play(dice)
    chosen = played && comesOff(state, played, id) ? played : null
    return !!chosen
  }, trace)
  return chosen
}

// How a member of the party who may answer the committed action does, with a
// defense or an opportunity attack, or null when none does.
export function chooseAnswer(state: SceneState, parties: readonly Party[], party: Party, open: RootAction, newId: () => string, trace?: Trace): Played | null {
  if (isOnSide(state, party, open.actorId)) return null
  for (const id of party.members) {
    const believed = getBelief(state, party, id)
    const declared = [
      ...getDefenseOptions(believed, id, open).flatMap((o) => {
        const next = defend(believed, id, open, o, newId)
        return next ? [{ label: `${o.draft.kind}${o.surge ? ' (surge)' : ''}`, played: next }] : []
      }),
      ...getOpportunities(believed, party, id, open, newId, settleWith(parties, newId)),
    ]
    if (declared.length === 0) continue
    const options: Option[] = [{ label: 'no defense', play: () => believed }, ...declared.map((d) => ({ label: d.label, play: () => d.played.state }))]
    const chosen = pick(believed, parties, party, id, 'answer', options, [id], newId, (index) => comesOff(state, declared[index - 1].played, id), trace)
    if (chosen > 0) return declared[chosen - 1].played
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
