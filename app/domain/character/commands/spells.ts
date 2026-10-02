import { CampaignCharacter, Character, SpellMethod } from "../../types"
import { SPELLS, SpellKey, isSpellKey } from "../../spells"
import { isCampaignCharacter } from "../../utils"
import { canLearnSpell, drawCharges } from "../rules/spells"
import { getHeldSize } from "../rules/concentration"
import { isSpellActive } from "../rules/effects"
import { findReadyItem } from "../../item/rules/containers"
import { hasAmmo } from "../../item/rules/items"
import { drawFromSource } from "../../item/commands/hands"

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

// spells.tex "Sustained": a held spell is let go of at will, for nothing.
export function releaseSpell(key: SpellKey): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => {
    if (!isCampaignCharacter(c) || !isSpellActive(c, key)) return c
    return { ...c, active: c.active.filter((e) => !(e.kind === 'spell' && e.key === key)) }
  }
}

// spells.tex "Sustained Spells": "The cost must be paid at the beginning of
// the next round to maintain the spell effect" — the charges a held spell
// draws from its item come out of it at the round change, at the size it
// was cast at (spells.tex "Amplify Spell"), a fraction of one by the
// percentile die; one whose item has too few left is let go.
export function payHeldSources(percent: () => number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => c.active.reduce((acc, e) => {
    if (e.kind !== 'spell' || !isSpellKey(e.key) || SPELLS[e.key].ammo === 0) return acc
    const item = findReadyItem(acc, e.itemId ?? '')?.item
    const charges = drawCharges(SPELLS[e.key].ammo, getHeldSize(acc, e.key), percent())
    return item && hasAmmo(item, charges) ? drawFromSource(item.id, charges)(acc) : releaseSpell(e.key)(acc)
  }, c)
}

// spells.tex "Sustained Spells": "Their effect ends when the caster stops
// concentrating on it" — every held spell at once, as an interruption
// breaks concentration.
export function loseConcentration(c: CampaignCharacter): CampaignCharacter {
  if (!c.active.some((e) => e.kind === 'spell')) return c
  return { ...c, active: c.active.filter((e) => e.kind !== 'spell') }
}
