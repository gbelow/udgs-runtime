import type { Character, Senses } from '../../types'
import { hasGrant } from './effects'

// combat.tex "Senses": the senses the character acts and reacts with. The
// stored ones are the creature's own, a monster's tuned by hand; a mutation
// changes them where it does better than they already do (abilities.tex
// "Chimerism"). What a mutation does only in the character's own turn is the
// fight's to add (scene/rules/detection.ts).
export function getSenses(c: Character): Senses {
  const { smell, hearing } = c.senses
  // abilities.tex "Bear Nose": "Increases smell radius to 10m at partial impairment"
  const keenSmell = hasGrant(c, 'bearNose') && smell.range !== null && smell.range < 10
  // abilities.tex "Bat Ears": "Reduces sensory penalty from hearing to -2"
  const keenHearing = hasGrant(c, 'batEars') && hearing.penalty > 2
  if (!keenSmell && !keenHearing) return c.senses
  return {
    ...c.senses,
    ...(keenSmell ? { smell: { ...smell, range: 10, partial: true } } : {}),
    ...(keenHearing ? { hearing: { ...hearing, penalty: 2 } } : {}),
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
