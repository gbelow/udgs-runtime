import type { Degree } from '../../types'

// play.tex "Degrees of success": over the DL by 10 is a critical, by 5 a
// hit, by 0 a graze, less a miss.
export function scoreTest(score: number, DL: number): Degree {
  const over = score - DL
  return over >= 10 ? 'critical' : over >= 5 ? 'hit' : over >= 0 ? 'graze' : 'miss'
}
