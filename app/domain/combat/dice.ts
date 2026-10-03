// Pure dice rules. The d10 is a game rule, so it lives in the domain — but
// the source of entropy is injected, keeping the domain deterministic and
// unit-testable (feed a scripted rng to exercise every path).

export const ROLL_MODES = ['normal', 'safe', 'risky'] as const
export type RollMode = (typeof ROLL_MODES)[number]

// The die a command is handed: thrown by whoever holds the entropy, told by
// the test whether it explodes.
export type Dice = (explodes: boolean) => number

// A percentile die, 0 to 99: two d10s, tens then units, neither exploding.
export function rollPercent(dice: Dice): number {
  return dice(false) * 10 + dice(false)
}

// The d10 reads 0 to 9. play.tex "Exploding die", where a test explodes: a 9
// adds a d6, and keeps adding while the d6 shows 6; a 0 subtracts them the
// same way.
export function rollD10(explodes: boolean, rng: () => number): number {
  const face = rollDie(10, rng) - 1
  if (!explodes || (face !== 9 && face !== 0)) return face
  const sign = face === 9 ? 1 : -1
  let total = face
  let d6: number
  do {
    d6 = rollDie(6, rng)
    total += sign * d6
  } while (d6 === 6)
  return total
}

// play.tex "Safe and risky tests": both dice are thrown in full, explosions
// included, and only then compared — safe keeps the one closest to 5, risky
// the one farthest. Two different results equally far from 5 are a draw and
// are thrown again.
export function rollModed(mode: RollMode, explodes: boolean, dice: Dice): number {
  if (mode === 'normal') return dice(explodes)
  for (;;) {
    const a = dice(explodes)
    const b = dice(explodes)
    const da = Math.abs(a - 5)
    const db = Math.abs(b - 5)
    if (da === db && a !== b) continue
    return (mode === 'safe') === (da <= db) ? a : b
  }
}

// A reproducible source of entropy for `rollD10`: the same seed gives the same
// run of numbers, in [0, 1).
export function seededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

// A plain uniform die. It carries no test rule, but it shares the reason
// rollD10 lives here: the entropy source is injected, so nothing in the app
// reaches for Math.random on its own.
export function rollDie(sides: number, rng: () => number): number {
  return Math.floor(rng() * sides) + 1
}
