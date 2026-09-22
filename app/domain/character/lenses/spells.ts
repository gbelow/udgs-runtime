import type { Area, Character, Spell, SpellMethod } from '../../types'
import { SPELLS, SPELL_KEYS, SpellKey } from '../../spells'
import { HIT_MARGIN, SPELL_MODIFICATIONS, SpellModification } from '../../tables'
import { isCampaignCharacter } from '../../utils'
import { getDM } from '../rules/helpers'
import { ResolvedTest, canCastSpell, canLearnSpell, getCastingDL, getMiracleSkill, getSpellSkill, isHit, resolveDL, resolveTest } from '../rules/spells'
import { isSpellActive } from '../rules/effects'

function knowledgeLabel(spell: Spell): string {
  return spell.knowledge.map((k) => `${k.name} ${k.level}`).join(', ')
}

function priceLabel(cost: { AP: number; STA: number; exhaustion: number; ET: number }): string {
  const parts = []
  if (cost.AP) parts.push(`${cost.AP} AP`)
  if (cost.STA) parts.push(`${cost.STA} STA`)
  if (cost.exhaustion) parts.push(`${cost.exhaustion} exh`)
  if (cost.ET) parts.push(`${cost.ET} ET`)
  return parts.join(' + ') || 'free'
}

export type SpellCatalogRow = {
  key: SpellKey
  name: string
  section: string
  type: string
  knowledge: string
  DL: number | null
  costText: string
  requirements: string
  description: string
  enhance: string
  learned: boolean
  learnable: Record<SpellMethod, boolean>
}

export function getSpellCatalogRows(c: Character): SpellCatalogRow[] {
  return SPELL_KEYS.map((key) => {
    const spell = SPELLS[key]
    return {
      key,
      name: spell.name,
      section: spell.section,
      type: spell.type,
      knowledge: knowledgeLabel(spell),
      DL: spell.DL,
      costText: spell.costText,
      requirements: spell.requirements,
      description: spell.description,
      enhance: spell.enhance,
      learned: key in c.spells,
      learnable: {
        intuitive: canLearnSpell(key, 'intuitive')(c),
        wizard: canLearnSpell(key, 'wizard')(c),
        cleric: canLearnSpell(key, 'cleric')(c),
      },
    }
  })
}

// The pending roll on this spell, if the last thing rolled was this spell:
// what it came to and what each improvement would cost against what is left.
export type PendingSpellView = {
  score: number
  hit: boolean
  SOP: number
  modifications: { name: SpellModification; SOP: number; text: string; times: number; affordable: boolean }[]
}

export type SpellSheetRow = {
  key: SpellKey
  name: string
  section: string
  type: string
  method: SpellMethod
  practice: number
  skill: number
  miracle: number // the same spell attempted as a miracle
  DL: number | null
  quickenedDL: number | null
  hitAt: number | null
  pending: PendingSpellView | null
  test: ResolvedTest | null
  effects: SpellEffectRow[]
  outcomes: { degree: string; text: string }[]
  range: string
  price: string
  costText: string
  description: string
  enhance: string
  canCast: boolean // with the focus surge and the price met (or the spell is held and a click ends it)
  canQuicken: boolean // castable at +4 DL without the surge
  active: boolean // a sustained spell currently held
}

function pendingView(c: Character, key: SpellKey, spell: Spell): PendingSpellView | null {
  if (!isCampaignCharacter(c) || c.pendingAction === null) return null
  const pending = c.pendingAction
  if (pending.kind !== 'spell' || pending.key !== key || spell.DL === null) return null
  return {
    score: pending.score,
    hit: isHit(pending.score, spell.DL),
    SOP: pending.SOP,
    modifications: (Object.keys(SPELL_MODIFICATIONS) as SpellModification[]).map((name) => ({
      name,
      SOP: SPELL_MODIFICATIONS[name].SOP,
      text: SPELL_MODIFICATIONS[name].text,
      times: pending.spent[name] ?? 0,
      affordable: pending.SOP >= SPELL_MODIFICATIONS[name].SOP,
    })),
  }
}

function rangeLabel(spell: Spell): string {
  return [
    spell.castRange && `cast ${spell.castRange}`,
    spell.castArea && `area ${spell.castArea}`,
  ].filter(Boolean).join(' · ')
}

// One of the spell's effects as the sheet reads it: what it does, to whom,
// how far, over what area, and the test it leaves — every number already
// scaled for this caster.
export type SpellEffectRow = {
  kind: string
  text: string
  target: string
  range: string
  test: ResolvedTest | null
}

function areaLabel(area: Area | null): string {
  if (!area) return ''
  return area.shape === 'explosion' ? `${area.radius}m radius` : `${area.length}m spray, ${area.angle}°`
}

export function getSpellEffectRows(c: Character, spell: Spell): SpellEffectRow[] {
  return spell.effects.map((e) => {
    const scale = e.scaled ? getDM(c) : 1
    const text = e.type === 'damage' ? e.effect.damage.map((d) => `${Math.floor(d.value * scale)} ${d.kind}`).join(' + ')
      : e.type === 'affliction' ? e.effect.key
      : e.type === 'cost' ? `${e.trigger} cost`
      : e.type
    return {
      kind: e.type,
      text,
      target: e.target + (e.duration !== 'instant' ? ` · ${e.duration}` : ''),
      range: [e.range !== null ? `${e.range}m` : '', areaLabel(e.area)].filter(Boolean).join(' · '),
      test: e.resist ? resolveDL(c, e.resist.dl, e.resist.roll) : null,
    }
  })
}

export function getSpellSheetRows(c: Character): SpellSheetRow[] {
  return (Object.keys(c.spells) as SpellKey[])
    .filter((key) => key in SPELLS)
    .map((key) => {
      const spell = SPELLS[key]
      const learned = c.spells[key]
      const hitAt = spell.DL === null ? null : spell.DL + HIT_MARGIN
      const active = isSpellActive(c, key)
      const canCast = active || canCastSpell(c, key, false)
      const canQuicken = !active && canCastSpell(c, key, true)
      return {
        key,
        name: spell.name,
        section: spell.section,
        type: spell.type,
        method: learned.method,
        practice: learned.practice,
        skill: getSpellSkill(c, key),
        miracle: getMiracleSkill(c, key),
        DL: spell.DL,
        quickenedDL: getCastingDL(spell, true),
        hitAt,
        pending: pendingView(c, key, spell),
        test: resolveTest(c, spell),
        effects: getSpellEffectRows(c, spell),
        outcomes: spell.outcomes === null ? [] :
          (['miss', 'graze', 'hit', 'crit'] as const).filter((d) => spell.outcomes![d]).map((d) => ({ degree: d, text: spell.outcomes![d] })),
        range: rangeLabel(spell),
        price: priceLabel(spell.cost),
        costText: spell.costText,
        description: spell.description,
        enhance: spell.enhance,
        canCast,
        canQuicken,
        active,
      }
    })
    .sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name))
}
