import type { Action, Degree } from '../types'

// Whether the action's test came to a hit or a critical.
export function isWon(root: Pick<Action, 'roll'>): boolean {
  return root.roll?.degree === 'hit' || root.roll?.degree === 'critical'
}

// combat.tex "Evasion": a reflex test against what is coming turns the
// target's degree against it — "On a graze ... only takes half damage", on
// a miss the whole of it, on a hit or better none.
export function resisted(degree: Degree): Degree {
  switch (degree) {
    case 'miss': return 'hit'
    case 'graze': return 'graze'
    default: return 'miss'
  }
}
