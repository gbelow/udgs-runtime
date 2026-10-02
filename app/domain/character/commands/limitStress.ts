import type { LimitStressAction } from '../../lists'
import type { CharacterUpdater } from '../../types'

// creating.tex "Limit Stress Actions": "Each character must choose a limit
// stress action."
export function setLimitStress(action: LimitStressAction | null): CharacterUpdater {
  return (c) => ({ ...c, limitStress: action })
}
