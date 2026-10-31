import type { ActiveEntry, Character } from '../../types'
import { SPELLS, SpellKey, isSpellKey } from '../../spells'
import { ABILITIES, type AbilityKey } from '../../abilities'
import { isCampaignCharacter } from '../../utils'
import { effectsOn, getActiveAbilityKeys, getActiveSpellKeys, isSpellActive } from './effects'
import { getSize } from './size'

// spells.tex "Sustained Spells": "actions that can be performed continuously
// while concentration is maintained" — a caster holding one is
// concentrating, and does nothing but what the spell they hold allows.
export function isConcentrating(c: Character): boolean {
  return getActiveSpellKeys(c).length > 0
}

// The abilities switched on that charge every round change: what, beside a
// held spell, the character pays for again or lets go of as the round
// changes.
export function getSustainedAbilities(c: Character): AbilityKey[] {
  return getActiveAbilityKeys(c).filter((key) => ABILITIES[key].activation === 'toggle' && effectsOn(ABILITIES[key].effect, 'end_round').length > 0)
}

// What the caster keeps of a held spell, and the size it was cast at.
export function getHeldEntry(c: Character, key: SpellKey): ActiveEntry | null {
  return isCampaignCharacter(c) ? c.active.find((e) => e.kind === 'spell' && e.key === key) ?? null : null
}

export function getHeldSize(c: Character, key: SpellKey): number {
  return getHeldEntry(c, key)?.size ?? getSize(c)
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

// The linking spell a cast by this caster works through: the one the spell
// requires, or for a spell that may be cast through a link, the one the
// caster holds; null for a cast that works through no link.
export function getCastLink(c: Character, key: SpellKey): SpellKey | null {
  const required = getLinkSpell(key)
  if (required !== null || !SPELLS[key].throughLink) return required
  return getActiveSpellKeys(c).find((held) => SPELLS[held].linkDL !== null) ?? null
}

// What a concentrating caster may still cast: the linking spell they hold,
// again, the spells cast through what they hold, and those that may be.
export function mayCastWhileConcentrating(c: Character, key: SpellKey): boolean {
  if (!isConcentrating(c)) return true
  if (SPELLS[key].linkDL !== null && isSpellActive(c, key)) return true
  return (SPELLS[key].throughLink && getCastLink(c, key) !== null) || getSustainingRequirements(key).some((held) => isSpellActive(c, held))
}
