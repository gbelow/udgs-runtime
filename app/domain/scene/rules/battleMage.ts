import type { ActionKind, SceneState } from '../types'
import { hasGrant } from '../../character/rules/effects'
import { isDefense } from './actionCatalog'

// abilities.tex "Battle Mage": a caster who keeps a spell going through what
// would otherwise end it. Concentrating is a cast that needs it (combat.tex
// "Concentration"), the same cast held over for the round to change, or a
// sustained spell held (spells.tex "Sustained Spells"). Level I, a cheaper
// Quicken Spell, is read by `getQuickenDL` (character/rules/spells.ts).

// "II. The character can defend actively while concentrating, with AP costs
// paid separately": a defense, or a reflex against a shot (the table's
// ruling), gives up neither a cast, a held one nor a held spell, and gets
// nothing back from it. Anything else gives them up as it would anyone's.
export function keepsConcentrationOn(state: SceneState, reactorId: string, kind: ActionKind | undefined): boolean {
  const c = state.characters[reactorId]
  return kind !== undefined && (isDefense(kind) || kind === 'evasion' || kind === 'guard') && !!c && hasGrant(c, 'concentratedDefense')
}
