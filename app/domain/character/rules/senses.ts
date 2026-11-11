import type { Character, Senses } from '../../types'
import { hasGrant } from './effects'

// combat.tex "Senses": the senses the character acts and reacts with. The
// stored ones are the creature's own, a monster's tuned by hand; a mutation
// changes them where it does better than they already do (abilities.tex
// "Chimerism").
export function getSenses(c: Character): Senses {
  const smell = c.senses.smell
  // abilities.tex "Bear Nose": "Increases smell radius to 10m at partial impairment"
  if (hasGrant(c, 'bearNose') && smell.range !== null && smell.range < 10) return { ...c.senses, smell: { ...smell, range: 10, partial: true } }
  return c.senses
}
