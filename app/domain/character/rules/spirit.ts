import type { AfflictionKey, Character, Degree, Delivery, SpiritBlow, SpiritEffect, TestRollKey } from '../../types'
import { SPIRIT_ATTACK } from '../../tables'
import { getSPI } from './characteristics'
import { getSM } from './size'
import { hasGrant } from './effects'
import { skillTermGetters } from './skills'
import { Term, sumTerms } from './terms'

// spells.tex "Spiritual Strike": a spiritual attack is its own thing, not the
// spell's — the spell is one way to launch it. The target tests their spirit
// against the attacker's (`SPIRIT_ATTACK`, tables.ts).

// "SPI + 3xSM", on either side.
export function getSpiritTerms(c: Character): Term[] {
  return [
    { label: 'SPI', value: getSPI(c) },
    { label: `${SPIRIT_ATTACK.SM}xSM`, value: SPIRIT_ATTACK.SM * getSM(c) },
  ]
}

// The attacker's side, with abilities.tex "Spirit of Battle"'s added DL.
export function getSpiritDLTerms(c: Character): Term[] {
  const battle = hasGrant(c, 'spiritOfBattle') ? [{ label: 'Spirit of Battle', value: SPIRIT_ATTACK.battleDL }] : []
  return [...getSpiritTerms(c), ...battle]
}

// The attack as this attacker launches it: the blow, and the test it leaves
// the target, the DL set from where the attacker stands now.
export function produceSpiritAttack(c: Character): Delivery {
  return {
    effect: { name: 'spiritual strike', trigger: 'instant', type: 'spirit', effect: SPIRIT_ATTACK.blows },
    degree: null,
    test: { roll: 'spirit', DL: sumTerms(getSpiritDLTerms(c)) },
    when: null,
    then: [],
    locks: null,
  }
}

// The blow a spirit effect lands at the degree it lands at; none at a miss.
export function getSpiritBlow(effect: SpiritEffect, degree: Degree | null): SpiritBlow | null {
  if (degree === null || degree === 'miss') return null
  return degree === 'graze' ? effect.graze : effect.hit
}

// What the target rolls a delivered test with, term by term.
export function getTestRollTerms(c: Character, roll: TestRollKey, situational?: readonly AfflictionKey[]): Term[] {
  return roll === 'spirit' ? getSpiritTerms(c) : skillTermGetters[roll](c, situational)
}
