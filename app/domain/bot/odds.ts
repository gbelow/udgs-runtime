import type { RollMode } from '../play/dice'

// The chance of each face a test keeps (play.tex "How skills work"): a plain
// d10 reads 0 to 9; a safe test keeps the one of two closest to 5, a risky
// one the farthest, and two different faces equally far from 5 are thrown
// again (`rollModed`, play/dice.ts). The die never explodes in play.

function faceOdds(mode: RollMode): readonly number[] {
  if (mode === 'normal') return Array.from({ length: 10 }, () => 0.1)
  const counts = Array.from({ length: 10 }, () => 0)
  let kept = 0
  for (let a = 0; a < 10; a++) {
    for (let b = 0; b < 10; b++) {
      const [da, db] = [Math.abs(a - 5), Math.abs(b - 5)]
      if (da === db && a !== b) continue
      counts[(mode === 'safe') === (da <= db) ? a : b]++
      kept++
    }
  }
  return counts.map((n) => n / kept)
}

const faces = new Map<RollMode, readonly number[]>()

export function getFaceOdds(mode: RollMode): readonly number[] {
  let odds = faces.get(mode)
  if (!odds) faces.set(mode, (odds = faceOdds(mode)))
  return odds
}

// What an attack's test does to its target at each degree, in harm: a miss,
// a graze, and a hit at each HOP from 0 (the last stands for any HOP past it).
export type HarmByDegree = { miss: number; graze: number; hits: readonly number[] }

// play.tex "Hit Overflow Point": over the DL by 5 is a hit with the rest as
// HOP; by 0 a graze, where the attack grazes at all (gear.tex "Piercing"); a
// miss below.
export function getExpectedHarm(skill: number, DL: number, grazes: boolean, mode: RollMode, harm: HarmByDegree): number {
  return getFaceOdds(mode).reduce((sum, p, face) => {
    const over = face + skill - DL
    const at = over >= 5 ? (harm.hits.length ? harm.hits[Math.min(over - 5, harm.hits.length - 1)] : 0) : over >= 0 && grazes ? harm.graze : harm.miss
    return sum + p * at
  }, 0)
}

// The most HOP the test can come to.
export function getMostHOP(skill: number, DL: number): number {
  return 9 + skill - DL - 5
}
