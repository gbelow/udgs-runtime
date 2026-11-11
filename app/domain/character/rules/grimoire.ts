import type { Character, Item } from '../../types'
import { isSpellKey, type SpellKey } from '../../spells'
import { hasGrant } from './effects'

// spells.tex "Wizard": "Wizards can attempt to interact with anything that
// has magical properties, without prior learning". A grimoire in the hands
// of a wizard offers the spells it holds, the ones they have not learned
// (the reading in the hands is the table's ruling).
export function getGrimoireFor(c: Character, key: SpellKey): Item | null {
  if (key in c.spells || !hasGrant(c, 'wizardSpells')) return null
  return c.held.find((i) => i.grimoire.includes(key)) ?? null
}

// The spells the grimoires the character holds offer them, unlearned.
export function getGrimoireSpells(c: Character): { key: SpellKey; book: Item }[] {
  if (!hasGrant(c, 'wizardSpells')) return []
  const offered = c.held.flatMap((book) => book.grimoire.filter(isSpellKey).map((key) => ({ key, book })))
  return offered.filter(({ key }, i) => !(key in c.spells) && offered.findIndex((o) => o.key === key) === i)
}
