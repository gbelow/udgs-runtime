import { CampaignCharacter, Character, SpellMethod } from "../../types"
import { SpellKey } from "../../spells"
import { isCampaignCharacter } from "../../utils"
import { canLearnSpell } from "../rules/spells"
import { isSpellActive } from "../rules/effects"

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
export function releaseSpell(key: SpellKey): (c: Character) => Character {
  return (c: Character) => {
    if (!isCampaignCharacter(c) || !isSpellActive(c, key)) return c
    return { ...c, active: c.active.filter((e) => !(e.kind === 'spell' && e.key === key)) }
  }
}

// spells.tex "Telepathic Link": a target the held spell now links to, and
// one it no longer does ("The link is broken by hitting on any will test
// triggered by the caster").
export function linkTarget(key: SpellKey, targetId: string): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    if (!isSpellActive(c, key)) return c
    return { ...c, active: c.active.map((e) => (e.kind === 'spell' && e.key === key && !(e.targets ?? []).includes(targetId) ? { ...e, targets: [...(e.targets ?? []), targetId] } : e)) }
  }
}

export function unlinkTarget(key: SpellKey, targetId: string): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    if (!isSpellActive(c, key)) return c
    return { ...c, active: c.active.map((e) => (e.kind === 'spell' && e.key === key && e.targets?.includes(targetId) ? { ...e, targets: e.targets.filter((id) => id !== targetId) } : e)) }
  }
}

// spells.tex "Sustained Spells": "Their effect ends when the caster stops
// concentrating on it" — every held spell at once, as an interruption
// breaks concentration.
export function loseConcentration(c: CampaignCharacter): CampaignCharacter {
  if (!c.active.some((e) => e.kind === 'spell')) return c
  return { ...c, active: c.active.filter((e) => e.kind !== 'spell') }
}
