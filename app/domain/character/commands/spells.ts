import { CampaignCharacter, Character, SpellMethod } from "../../types"
import { SPELLS, SpellKey } from "../../spells"
import { SPELL_MODIFICATIONS, SpellModification } from "../../tables"
import { isCampaignCharacter } from "../../utils"
import { canCastSpell, canLearnSpell, getCastingDL, getSpellSkill } from "../rules/spells"
import { resolveTest } from "../../combat/rules/test"
import type { Dice } from "../../combat/dice"
import { isSpellActive } from "../rules/effects"
import { deliver } from "./deliver"
import { getSelfEffects, produceSpellEffect } from "../rules/production"
import { payCost } from "./cost"
import { chargeItem } from "../../item/commands/hands"

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

// Casts a known spell: the price is paid whatever
// the die says ("In case of failure, it fails and the AP and STA are lost"),
// the roll plus skill is scored against the casting DL and what is left over
// a hit becomes the pending action's SOPs. Quicken forgoes the focus surge
// for +4 DL. A sustained spell that hit is taken hold of, so its upkeep comes
// due at the round change; casting it again while held releases it for free.
export function castSpell(key: SpellKey, dice: Dice, quicken = false): (c: Character) => Character {
  return (c: Character) => {
    if (!isCampaignCharacter(c)) return c
    if (isSpellActive(c, key)) {
      return { ...c, active: c.active.filter((e) => !(e.kind === 'spell' && e.key === key)) }
    }
    if (!canCastSpell(c, key, quicken)) return c
    const spell = SPELLS[key]
    const DL = getCastingDL(spell, quicken)
    if (DL === null) return c
    const { score, degree, HOP: SOP } = resolveTest({ skill: getSpellSkill(c, key), DL, explodes: false, scale: 'overflow', grazes: !quicken }, dice)
    // the casting price, then whatever the spell lists as instant
    // the casting price, then what the spell does to the caster; what it
    // does to others is produced where there are others to aim at
    const paid = getSelfEffects(spell).filter((e) => e.trigger === 'instant').map((e) => produceSpellEffect(c, e))
      .reduce((acc, delivery) => deliver(delivery)(acc), payCost(spell.cost)(c))
    const hit = degree === 'hit'
    // spells.tex "Charged": a charged spell that hit is loaded into an item
    const charged = spell.type === 'charged' && hit ? chargeItem(key)(paid) as CampaignCharacter : paid
    return {
      ...charged,
      pendingAction: { kind: 'spell', key, score, SOP, spent: {} },
      active: spell.type === 'sustained' && hit ? [...charged.active, { kind: 'spell', key }] : charged.active,
    }
  }
}

// Buys one improvement out of the pending spell's SOPs.
export function applyModification(mod: SpellModification): (c: Character) => Character {
  return (c: Character) => {
    if (!isCampaignCharacter(c) || c.pendingAction === null || c.pendingAction.kind !== 'spell') return c
    const price = SPELL_MODIFICATIONS[mod].SOP
    if (c.pendingAction.SOP < price) return c
    const { spent } = c.pendingAction
    return {
      ...c,
      pendingAction: {
        ...c.pendingAction,
        SOP: c.pendingAction.SOP - price,
        spent: { ...spent, [mod]: (spent[mod] ?? 0) + 1 },
      },
    }
  }
}

// Done with the roll: nothing is refunded, the slot is simply freed.
export function clearPendingAction(c: Character): Character {
  if (!isCampaignCharacter(c) || c.pendingAction === null) return c
  return { ...c, pendingAction: null }
}
