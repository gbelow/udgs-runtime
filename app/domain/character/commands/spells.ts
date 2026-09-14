import { Character, SpellMethod } from "../../types"
import { SPELLS, SpellKey } from "../../spells"
import { isCampaignCharacter } from "../../utils"
import { canLearnSpell } from "../lenses/spells"
import { isSpellActive } from "../lenses/effects"
import { canAfford } from "../lenses/cost"
import { payCost } from "./cost"

export function learnSpell(key: SpellKey, method: SpellMethod): (c: Character) => Character {
  return (c: Character) => {
    if (!canLearnSpell(key, method)(c)) return c
    return { ...c, spells: { ...c.spells, [key]: { method, practice: 0 } } }
  }
}

// A forgotten sustained spell cannot stay held.
export function forgetSpell(key: string): (c: Character) => Character {
  return (c: Character) => {
    if (!(key in c.spells)) return c
    const { [key]: _forgotten, ...spells } = c.spells
    if (isCampaignCharacter(c)) {
      return { ...c, spells, active: c.active.filter((e) => !(e.kind === 'spell' && e.key === key)) }
    }
    return { ...c, spells }
  }
}

// spells.tex "Learning spells": the per-spell skill is practiced one point
// at a time; the XP it costs is the table's.
export function practiceSpell(key: SpellKey, delta: number): (c: Character) => Character {
  return (c: Character) => {
    const learned = c.spells[key]
    if (!learned) return c
    const practice = Math.max(0, learned.practice + delta)
    if (practice === learned.practice) return c
    return { ...c, spells: { ...c.spells, [key]: { ...learned, practice } } }
  }
}

// Casts a known spell: the price is paid before the roll and nothing else
// moves — the test and its effect are the table's. A sustained spell is also
// taken hold of, so its upkeep comes due at the round change; casting it
// again while held releases it for free. Refused when the character cannot
// afford it, like an attack.
export function castSpell(key: SpellKey): (c: Character) => Character {
  return (c: Character) => {
    if (!isCampaignCharacter(c) || !(key in c.spells)) return c
    const spell = SPELLS[key]
    if (isSpellActive(c, key)) {
      return { ...c, active: c.active.filter((e) => !(e.kind === 'spell' && e.key === key)) }
    }
    if (!canAfford(c, spell.cost)) return c
    const paid = payCost(spell.cost)(c)
    if (spell.type !== 'sustained') return paid
    return { ...paid, active: [...paid.active, { kind: 'spell', key }] }
  }
}
