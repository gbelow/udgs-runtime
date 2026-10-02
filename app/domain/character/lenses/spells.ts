import { requirementsLabel } from '../rules/requirements'
import { DEGREES, type Area, type Character, type Spell, type SpellMethod } from '../../types'
import { SPELLS, SPELL_KEYS, SpellKey } from '../../spells'
import { HIT_MARGIN } from '../../tables'
import { getSpellEffects, produceEffects } from '../rules/production'
import { ResolvedTest, canLearnSpell, getCastSize, getCastingDL, getMiracleSkill, getSpellSkill, resolveDL, resolveTest } from '../rules/spells'
import { isSpellActive } from '../rules/effects'

function knowledgeLabel(spell: Spell): string {
  return spell.knowledge.map((k) => `${k.name} ${k.level}`).join(', ')
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
  castRequirements: string
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
      requirements: requirementsLabel(spell.requirements),
      castRequirements: requirementsLabel(spell.castRequirements),
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
  hitAt: number | null
  test: ResolvedTest | null
  effects: SpellEffectRow[]
  outcomes: { degree: string; text: string }[]
  range: string
  costText: string
  description: string
  enhance: string
  active: boolean // a sustained spell currently held
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

export function getSpellEffectRows(c: Character, key: SpellKey): SpellEffectRow[] {
  return produceEffects(c, getSpellEffects(c, key), getCastSize(c, key, 0)).map((e) => {
    const text = e.type === 'damage' ? e.effect.damage.map((d) => `${d.value} ${d.kind}`).join(' + ')
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
      const DL = getCastingDL(c, spell, false)
      const hitAt = DL === null ? null : DL + HIT_MARGIN
      const active = isSpellActive(c, key)
      return {
        key,
        name: spell.name,
        section: spell.section,
        type: spell.type,
        method: learned.method,
        practice: learned.practice,
        skill: getSpellSkill(c, key),
        miracle: getMiracleSkill(c, key),
        DL,
        hitAt,
        test: resolveTest(c, spell),
        effects: getSpellEffectRows(c, key),
        outcomes: spell.outcomes === null ? [] :
          DEGREES.filter((d) => spell.outcomes![d].text).map((d) => ({ degree: d, text: spell.outcomes![d].text })),
        range: rangeLabel(spell),
        costText: spell.costText,
        description: spell.description,
        enhance: spell.enhance,
        active,
      }
    })
    .sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name))
}
