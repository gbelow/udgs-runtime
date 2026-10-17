import { z } from 'zod'
import { DIE_SOURCES, ROLL_MODES, readD10, recordDice, rollModed, type D10Throw, type Dice, type DieSource, type RollMode } from './dice'
import { describeRoll, describeSource, resolveTest, toRoll, type Test, type TestResult, type TestRoll } from './test'

// play.tex "How skills work": a die the table has called for, waiting on
// whoever throws it. A call for a test keeps the test as it stood when it was
// called, so the die answers that test; a bare die (a target's, thrown before
// what it will be read against is known) keeps none. `source` is where the
// die came from: the screen, the dice tray, or typed in from the table. An
// answered call keeps its die only until the step that called it goes on.
export const CalledTestSchema = z.object({
  skill: z.number(),
  DL: z.number(),
  scale: z.enum(['degrees', 'overflow']),
  grazes: z.boolean().default(false),
})

export const DieCallSchema = z.object({
  id: z.string(),
  roller: z.string(),
  label: z.string(),
  explodes: z.boolean().default(false),
  mode: z.enum(ROLL_MODES).default('normal'),
  test: CalledTestSchema.nullable().default(null),
  die: z.number().nullable().default(null),
  source: z.enum(DIE_SOURCES).default('screen'),
})
export type DieCall = z.infer<typeof DieCallSchema>

// The calls a sequence keeps, by id. An id names what the die is for (whose
// Will test, which group's), so the same die called again is the same call.
export const CallsSchema = z.record(z.string(), DieCallSchema)
export type Calls = z.infer<typeof CallsSchema>

// Whoever throws what a command calls for: `dice` throws the percentiles,
// which nobody is called for, and `answer` the die of a call as it is made,
// or null to leave it to the table. Plain `Dice` answers every call at once.
export type Thrower = { dice: Dice; answer: (call: DieCall) => number | null }
export type Throw = Dice | Thrower

export const toThrower = (t: Throw): Thrower =>
  typeof t === 'function' ? { dice: t, answer: (call) => rollModed(call.mode, call.explodes, t) } : t

// Every call left to the table, the percentiles thrown with `dice`.
export const toTable = (dice: Dice): Thrower => ({ dice, answer: () => null })

export type DieSpec = { id: string; roller: string; label: string; explodes?: boolean; mode?: RollMode }
export type CallSpec = Omit<DieSpec, 'explodes'> & { test: Test }

// What a test called for came to.
export type CallResult = TestResult & { source: DieSource }

const toCalled = (t: Test): NonNullable<DieCall['test']> =>
  ({ skill: t.skill, DL: t.DL, scale: t.scale, grazes: t.scale === 'overflow' ? t.grazes : false })

const toTest = (t: NonNullable<DieCall['test']>, explodes: boolean): Test =>
  t.scale === 'overflow' ? { skill: t.skill, DL: t.DL, explodes, scale: 'overflow', grazes: t.grazes } : { skill: t.skill, DL: t.DL, explodes, scale: 'degrees' }

const sameCall = (a: DieCall, b: DieCall): boolean =>
  a.roller === b.roller && a.mode === b.mode && a.explodes === b.explodes && JSON.stringify(a.test) === JSON.stringify(b.test)

// A step that throws dice, run over the calls already made: each die it calls
// for is the one answered, or null while it waits on the table. The calls the
// step made, answered or not, are in `calls` afterwards, and none it did not
// make; a call whose test has changed since it was answered (a new roller,
// another DL) is called again, since its die answered another test.
export function makeCaller(made: Calls, thrown: Throw) {
  const { dice, answer } = toThrower(thrown)
  const calls: Calls = {}
  const call = (fresh: DieCall): DieCall => {
    const before = made[fresh.id]
    if (before && sameCall(before, fresh)) return before
    return { ...fresh, die: answer(fresh) }
  }
  const die = (spec: DieSpec, test: Test | null = null): number | null => {
    const kept = call({ id: spec.id, roller: spec.roller, label: spec.label, explodes: spec.explodes ?? false, mode: spec.mode ?? 'normal', test: test && toCalled(test), die: null, source: 'screen' })
    calls[spec.id] = kept
    return kept.die
  }
  const test = (spec: CallSpec): CallResult | null => {
    const thrownDie = die({ ...spec, explodes: spec.test.explodes }, spec.test)
    return thrownDie === null ? null : { ...resolveTest(spec.test, () => thrownDie), source: calls[spec.id].source }
  }
  const waiting = () => getOpenCalls(calls).length > 0
  return { die, test, dice, calls, waiting }
}

export type Caller = ReturnType<typeof makeCaller>

export function getOpenCalls(calls: Calls): DieCall[] {
  return Object.values(calls).filter((c) => c.die === null)
}

// Why nothing else may be done in a part of play while it waits on the
// dice it called for, or null when it waits on none.
export function getDiceBar(...called: Calls[]): string | null {
  const open = called.reduce((n, calls) => n + getOpenCalls(calls).length, 0)
  return open > 0 ? `waiting on ${open} ${open === 1 ? 'die' : 'dice'}` : null
}

// The table's ruling: while a part of play waits on a die, the only change it
// takes is to the dice it waits on (a die going in, a call taken back), so
// whatever the die is read against stays as it was when it was called for.
// Anything else leaves it as it was.
export function holdForDice<T>(called: (t: T) => Calls[], before: T, after: T): T {
  const was = called(before)
  if (getDiceBar(...was) === null) return after
  const now = called(after)
  return now.every((calls, i) => calls === was[i]) ? before : after
}

// play.tex: "Use the d10 that has 0 to 9 on it", and only a die that explodes
// goes past it. Safe and risky tests are answered with the die kept of the two.
export function getDieBar(explodes: boolean, die: number): string | null {
  if (!Number.isInteger(die)) return 'a die is a whole number'
  if (!explodes && (die < 0 || die > 9)) return 'the d10 reads 0 to 9'
  return null
}

// The call answered with `die`. Refused for a call answered already, or a die
// it cannot show.
export function answerCall(calls: Calls, id: string, die: number, source: DieSource): Calls {
  const call = calls[id]
  if (!call || call.die !== null || getDieBar(call.explodes, die)) return calls
  return { ...calls, [id]: { ...call, die, source } }
}

// A call as the table reads it: who rolls, for what, against what (nothing
// yet, for a bare die), how the die is read, and what it came to once answered.
export type CallRow = { id: string; roller: string; name: string; label: string; skill: number | null; DL: number | null; explodes: boolean; how: string[]; result: string | null }

// play.tex "Safe and risky tests", "Exploding die"
const HOW: Record<RollMode, string> = {
  normal: '',
  safe: 'safe: roll two, keep the one closer to 5',
  risky: 'risky: roll two, keep the one farther from 5',
}

const describeCall = (c: DieCall): string | null => {
  if (c.die === null) return null
  if (!c.test) return `die ${c.die}${describeSource(c.source)}`
  const die = c.die
  return describeRoll({ ...resolveTest(toTest(c.test, c.explodes), () => die), source: c.source })
}

export function getCallRows(calls: Calls, nameOf: (id: string) => string): CallRow[] {
  return Object.values(calls).map((c) => ({
    id: c.id, roller: c.roller, name: nameOf(c.roller), label: c.label, skill: c.test?.skill ?? null, DL: c.test?.DL ?? null, explodes: c.explodes,
    how: [HOW[c.mode], c.explodes ? 'explodes: on a 9 add a d6, on a 0 take one away, again while it shows 6' : ''].filter(Boolean),
    result: describeCall(c),
  }))
}

// The die the screen rolls for a call, explosions included, with the faces it
// was thrown with as the tray throws them: a round for a plain test, or for
// each pair of a safe or risky one, thrown again while the pair is a draw, so
// the die is read off the last round's `kept` set.
export type TrayThrow = { die: number; rounds: D10Throw[][]; kept: number }

export function throwCall(call: DieCall, rng: () => number): TrayThrow {
  const { dice, thrown } = recordDice(rng)
  const die = rollModed(call.mode, call.explodes, dice)
  const size = call.mode === 'normal' ? 1 : 2
  const rounds: D10Throw[][] = []
  for (let i = 0; i < thrown.length; i += size) rounds.push(thrown.slice(i, i + size))
  return { die, rounds, kept: Math.max(0, rounds.at(-1)!.findIndex((t) => readD10(t) === die)) }
}

export const toCallRoll = (result: CallResult): TestRoll => toRoll(result)
