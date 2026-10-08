import type { CombatState } from '../../combat/types'
import { getOpenAction } from '../../combat/rules/log'

// Why the fight cannot give its characters back to the party now.
export function getReturnBar(fight: CombatState): string | null {
  if (Object.keys(fight.characters).length === 0) return 'nobody is in the fight'
  return getOpenAction(fight) ? 'an action is being played out' : null
}
