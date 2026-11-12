import type { Character, Senses } from '../../types'
import { ABILITY_FAMILY_OF, getAbilityLevel } from '../../abilities'
import { getActiveAbilityKeys, hasGrant } from './effects'

// abilities.tex "Synesthesia I|II|III": "range=5/10/20 meters", by the stage
// learned.
const SYNESTHESIA_RANGE = [5, 10, 20] as const

// abilities.tex "Synesthesia I|II|III": "Maintains an energy perimeter that
// amplifies perception, which is a passive sense with no sensory penalty"
// while it is held. The range of the highest stage learned; null while it is
// not held.
function getSynesthesiaRange(c: Character): number | null {
  if (!getActiveAbilityKeys(c).some((key) => ABILITY_FAMILY_OF[key] === 'synesthesia')) return null
  const level = getAbilityLevel(c, 'synesthesia')
  return level > 0 ? SYNESTHESIA_RANGE[Math.min(level, SYNESTHESIA_RANGE.length) - 1] : null
}

// combat.tex "Senses": the senses the character acts and reacts with. The
// stored ones are the creature's own, a monster's tuned by hand; a mutation
// or a held ability changes them where it does better than they already do
// (abilities.tex "Chimerism"). What a mutation does only in the character's
// own turn is the fight's to add (scene/rules/detection.ts).
export function getSenses(c: Character): Senses {
  const { smell, hearing, synesthesia } = c.senses
  // abilities.tex "Bear Nose": "Increases smell radius to 10m at partial impairment"
  const keenSmell = hasGrant(c, 'bearNose') && smell.range !== null && smell.range < 10
  // abilities.tex "Bat Ears": "Reduces sensory penalty from hearing to -2"
  const keenHearing = hasGrant(c, 'batEars') && hearing.penalty > 2
  const perimeter = getSynesthesiaRange(c)
  const ownPerimeter = synesthesia.hasSense ? synesthesia.range : 0
  const sensing = perimeter !== null && ownPerimeter !== null && ownPerimeter < perimeter
  if (!keenSmell && !keenHearing && !sensing) return c.senses
  return {
    ...c.senses,
    ...(keenSmell ? { smell: { ...smell, range: 10, partial: true } } : {}),
    ...(keenHearing ? { hearing: { ...hearing, penalty: 2 } } : {}),
    // a passive sense is one that reacts; abilities.tex "Blind Combat": "Uses
    // synesthesia as an active sense"
    ...(sensing ? { synesthesia: { ...synesthesia, hasSense: true, range: perimeter, penalty: 0, active: hasGrant(c, 'blindCombat'), reactive: true } } : {}),
  }
}

// abilities.tex "Bat Ears": "Hearing becomes an active sense during the
// character's turn, but has only 20m range". The senses of a character whose
// turn it is.
export function getSensesInTurn(c: Character): Senses {
  const senses = getSenses(c)
  if (!hasGrant(c, 'batEars')) return senses
  const range = senses.hearing.range === null ? 20 : Math.min(senses.hearing.range, 20)
  return { ...senses, hearing: { ...senses.hearing, active: true, range } }
}
