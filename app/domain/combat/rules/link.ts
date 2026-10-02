import type { Character } from '../../types'
import type { CombatState } from '../types'
import { SPELLS, type SpellKey } from '../../spells'
import { getActiveSpellKeys } from '../../character/rules/effects'
import { getLinks, getPartner } from './partners'

// spells.tex "Telepathic Link": who a held spell links its caster to, by
// character id.
export function getLinkedTargets(state: CombatState, casterId: string, key: SpellKey): string[] {
  return getLinks(state, casterId, key).map((l) => getPartner(l, casterId))
}

// "Each simultaneous link increases the difficulty of spellcasting test by
// 3." — what one held spell's links add, and what all of them do.
export function getLinkDLOf(state: CombatState, c: Character, key: SpellKey): number {
  return (SPELLS[key].linkDL ?? 0) * getLinkedTargets(state, c.id, key).length
}

export function getLinkDL(state: CombatState, c: Character): number {
  return getActiveSpellKeys(c).reduce((sum, key) => sum + getLinkDLOf(state, c, key), 0)
}
