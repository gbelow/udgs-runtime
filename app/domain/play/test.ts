import { z } from 'zod'
import { DegreeSchema, type Degree } from '../types'
import { DIE_SOURCES, type Dice, type DieSource } from './dice'
import type { Term } from '../character/rules/terms'

// play.tex "How skills work": the test every part of play makes, in a fight, an
// exploration turn or downtime alike.

// A skill test as the book defines it: a skill against a DL or an opposing
// skill, read on one of two scales. `degrees` is the four-stage one;
// `overflow` is play.tex "Hit Overflow Point": the critical band is not a
// degree but HOP to spend, and without `grazes` (gear.tex "Piercing":
// "Grazes behave like a miss") a graze is a miss. The die explodes only
// where the test says it does.
type TestBase = { skill: number; DL: number; explodes: boolean; terms?: { skill: Term[]; DL: Term[] } }
export type Test =
  | TestBase & { scale: 'degrees' }
  | TestBase & { scale: 'overflow'; grazes: boolean }

// play.tex "Degrees of success": over the DL by 10 is a critical, by 5 a
// hit, by 0 a graze, less a miss.
function scoreTest(over: number): Degree {
  return over >= 10 ? 'critical' : over >= 5 ? 'hit' : over >= 0 ? 'graze' : 'miss'
}

// The degree a score comes to against a DL.
export function getDegree(score: number, DL: number): Degree {
  return scoreTest(score - DL)
}

// What the die came to and what it meant, with the terms the skill and the
// DL were added up from.
export type TestResult = { die: number; DL: number; score: number; degree: Degree; HOP: number; skillTerms: Term[]; DLTerms: Term[] }

export function resolveTest(test: Test, dice: Dice): TestResult {
  const die = dice(test.explodes)
  const score = die + test.skill
  const over = score - test.DL
  const base = { die, DL: test.DL, score, skillTerms: test.terms?.skill ?? [], DLTerms: test.terms?.DL ?? [] }
  if (test.scale === 'degrees') return { ...base, degree: scoreTest(over), HOP: 0 }
  if (over >= 5) return { ...base, degree: 'hit', HOP: over - 5 }
  if (over >= 0 && test.grazes) return { ...base, degree: 'graze', HOP: 0 }
  return { ...base, degree: 'miss', HOP: 0 }
}

// A test as it is kept to be read afterwards: the die, the score it came to,
// the DL and the degree, and where the die came from when the screen did not
// roll it.
export const TestRollSchema = z.object({
  die: z.number(),
  score: z.number(),
  DL: z.number(),
  degree: DegreeSchema,
  source: z.enum(DIE_SOURCES).optional(),
})
export type TestRoll = z.infer<typeof TestRollSchema>

export const toRoll = ({ die, score, DL, degree, source }: TestRoll): TestRoll => ({ die, score, DL, degree, ...(source && source !== 'screen' ? { source } : {}) })

type ReadRoll = { score: number; DL: number; degree: string; source?: DieSource }

const SOURCE_MARK: Record<DieSource, string> = { screen: '', thrown: ' (die thrown)', entered: ' (die entered)' }

// Where a die came from, to follow a line, when the screen did not roll it.
export const describeSource = (source: DieSource): string => SOURCE_MARK[source]

// A roll as a line of text: the score against the DL, and the degree.
export function describeRoll({ score, DL, degree, source = 'screen' }: ReadRoll): string {
  return `${score} vs DL ${DL}, ${degree}${describeSource(source)}`
}

// What a test came to, to follow a line: the roll, if one was made, and a
// note on it, if any.
export function describeOutcome(roll: ReadRoll | null, note = ''): string {
  return `${roll ? `: ${describeRoll(roll)}` : ''}${note ? ` — ${note}` : ''}`
}
