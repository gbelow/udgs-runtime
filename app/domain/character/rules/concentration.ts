import type { ActiveEntry, Character } from '../../types'
import { SPELLS, SpellKey, isSpellKey } from '../../spells'
import { isCampaignCharacter } from '../../utils'
import { getActiveSpellKeys, isSpellActive } from './effects'
import { getSize } from './misc'

// spells.tex "Sustained Spells": "actions that can be performed continuously
// while concentration is maintained" — a caster holding one is
// concentrating, and does nothing but what the spell they hold allows.
export function isConcentrating(c: Character): boolean {
  return getActiveSpellKeys(c).length > 0
}

// What the caster keeps of a held spell, and the size it was cast at.
export function getHeldEntry(c: Character, key: SpellKey): ActiveEntry | null {
  return isCampaignCharacter(c) ? c.active.find((e) => e.kind === 'spell' && e.key === key) ?? null : null
}

export function getHeldSize(c: Character, key: SpellKey): number {
  return getHeldEntry(c, key)?.size ?? getSize(c)
}

// Who a held spell links its caster to, by character id; none for a spell
// that is not held or links nobody.
export function getLinkedTargets(c: Character, key: SpellKey): string[] {
  if (!isSpellActive(c, key) || SPELLS[key].linkDL === null) return []
  return getHeldEntry(c, key)?.targets ?? []
}

// spells.tex "Telepathic Link": "Each simultaneous link increases the
// difficulty of spellcasting test by 3." — what one held spell's links add,
// and what all of them do.
export function getLinkDLOf(c: Character, key: SpellKey): number {
  return (SPELLS[key].linkDL ?? 0) * getLinkedTargets(c, key).length
}

export function getLinkDL(c: Character): number {
  return getActiveSpellKeys(c).reduce((sum, key) => sum + getLinkDLOf(c, key), 0)
}

// The spells a spell is cast through: what the caster must be holding to
// cast it at all.
export function getSustainingRequirements(key: SpellKey): SpellKey[] {
  return SPELLS[key].castRequirements.flatMap((item) => item.filter((alt) => alt.kind === 'sustaining' && !alt.not).map((alt) => alt.name)).filter(isSpellKey)
}

// The held spell whose links a cast of this one works through: the spell
// itself when it links ("It is possible to cast the spell again to affect
// multiple targets"), or the linking spell it has to be cast through
// ("These spells are made against all targets affected by link
// simultaneously"); null for a spell that works through no link.
export function getLinkSpell(key: SpellKey): SpellKey | null {
  if (SPELLS[key].linkDL !== null) return key
  return getSustainingRequirements(key).find((held) => SPELLS[held].linkDL !== null) ?? null
}

// What a concentrating caster may still cast: the linking spell they hold,
// again, and the spells cast through what they hold.
export function mayCastWhileConcentrating(c: Character, key: SpellKey): boolean {
  if (!isConcentrating(c)) return true
  if (SPELLS[key].linkDL !== null && isSpellActive(c, key)) return true
  return getSustainingRequirements(key).some((held) => isSpellActive(c, held))
}
