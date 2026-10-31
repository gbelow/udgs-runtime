import type { PrepareAction } from '../types'

// abilities.json "Battle Commands": "Can prepare actions for allies that can
// understand the command. The ally is not forced to follow the command." Who
// makes a prepared action once its trigger comes: the one it was prepared
// for, or its preparer. Anyone at all may be commanded (the table's ruling:
// it can only be to their benefit).
export function getPerformerId(p: Pick<PrepareAction, 'actorId' | 'forId'>): string {
  return p.forId || p.actorId
}
