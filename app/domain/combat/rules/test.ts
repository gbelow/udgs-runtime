import type { ActionRoll, Degree } from '../types'
import type { Dice } from '../dice'

// A skill test as the book defines it: a skill against a DL or an opposing
// skill, read on one of two scales. `degrees` is the four-stage one;
// `overflow` is play.tex "Hit Overflow Point": the critical band is not a
// degree but HOP to spend, and without `grazes` (gear.tex "Piercing":
// "Grazes behave like a miss") a graze is a miss. The die explodes only
// where the test says it does.
type TestBase = { skill: number; DL: number; explodes: boolean }
export type Test =
  | TestBase & { scale: 'degrees' }
  | TestBase & { scale: 'overflow'; grazes: boolean }

// play.tex "Degrees of success": over the DL by 10 is a critical, by 5 a
// hit, by 0 a graze, less a miss.
export function scoreTest(over: number): Degree {
  return over >= 10 ? 'critical' : over >= 5 ? 'hit' : over >= 0 ? 'graze' : 'miss'
}

export function resolveTest(test: Test, dice: Dice): ActionRoll {
  const die = dice(test.explodes)
  const score = die + test.skill
  const over = score - test.DL
  const base = { die, DL: test.DL, score }
  if (test.scale === 'degrees') return { ...base, degree: scoreTest(over), HOP: 0 }
  if (over >= 5) return { ...base, degree: 'hit', HOP: over - 5 }
  if (over >= 0 && test.grazes) return { ...base, degree: 'graze', HOP: 0 }
  return { ...base, degree: 'miss', HOP: 0 }
}
