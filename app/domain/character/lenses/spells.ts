import { Character, Spell, SpellMethod } from '../../types'
import { SPELLS, SPELL_KEYS, SpellKey } from '../../spells'
import { HIT_MARGIN, SPELL_MODIFICATIONS } from '../../tables'
import { getCharisma, getDevotion, getSPI } from './characteristics'
import { getDivine, getMiracle, getSchoolCasting } from './magic'
import { getAccuracy, getStrike } from './skills'
import { getDM, getSM } from './helpers'
import { getKnowledge } from './knowledge'
import { isSpellActive } from './effects'
import { canAfford } from './cost'
import { isCampaignCharacter } from '../../utils'

// spells.tex "Learning spells".

// The highest knowledge requirement a spell names — what a miracle is measured
// against and what the intuitive route caps at.
function requirementLevel(spell: Spell): number {
  return Math.max(0, ...spell.knowledge.map((k) => k.level))
}

// The knowledge a wizard casts this spell with: the highest the character
// holds among those the spell names, the spell's own school when it names
// none.
export function getCastingKnowledge(c: Character, spell: Spell): string {
  const named = spell.knowledge.map((k) => k.name)
  if (named.length === 0) return spell.section
  return named.reduce((best, name) => (getKnowledge(name)(c) > getKnowledge(best)(c) ? name : best))
}

export function getMethodSkill(c: Character, spell: Spell, method: SpellMethod): number {
  switch (method) {
    case 'wizard': return getSchoolCasting(getCastingKnowledge(c, spell))(c)
    case 'cleric': return getDivine(c)
    case 'intuitive': return 0
  }
}

// "it is possible to improve on a specific spell starting at the skill level
// that the character has when they learn it" — practice is a floor raised
// with XP, never below what the method gives for free.
export function getSpellSkill(c: Character, key: SpellKey): number {
  const learned = c.spells[key]
  if (!learned) return 0
  return Math.max(learned.practice, getMethodSkill(c, SPELLS[key], learned.method))
}

// "-3 penalty on the test per devotion level under the spell's knowledge
// requirement"
export function getMiracleSkill(c: Character, key: SpellKey): number {
  const shortfall = Math.max(0, requirementLevel(SPELLS[key]) - getDevotion(c))
  return getMiracle(c) - 3 * shortfall
}

// "It is not possible to learn spells with knowledge requirements above 3
// this way." Everything else the book asks of learning (XP, the grimoire
// test, the deity's list) is the table's.
export function canLearnSpell(key: SpellKey, method: SpellMethod): (c: Character) => boolean {
  return (c: Character) => {
    if (key in c.spells) return false
    if (method === 'intuitive') return requirementLevel(SPELLS[key]) <= 3
    return true
  }
}

// The DL side of a spell's test resolved for this caster. Terms the domain
// knows become a number; the rest ("morale aggravators", "poison DL") are
// handed back as words for the table to add.
export type ResolvedTest = {
  value: number | null // the sum of what resolved, null when nothing did
  extra: string // the unresolved terms, joined
  roll: string // what the defender rolls
}

function resolveTerm(c: Character, term: string): number | null {
  if (/^\d+$/.test(term)) return Number(term)
  const scaled = term.match(/^(\d+)xSM$/)
  if (scaled) return Number(scaled[1]) * getSM(c)
  switch (term.toLowerCase()) {
    case 'charisma': return getCharisma(c)
    case 'accuracy': return getAccuracy(c)
    case 'strike': return getStrike(c)
    case 'spi': return getSPI(c)
    default: return null
  }
}

export function resolveTest(c: Character, spell: Spell): ResolvedTest | null {
  if (!spell.test) return null
  const terms = spell.test.dl.split('+').map((t) => t.trim()).filter(Boolean)
  const resolved = terms.map((t) => [t, resolveTerm(c, t)] as const)
  const known = resolved.filter(([, v]) => v !== null).map(([, v]) => v as number)
  return {
    value: known.length ? known.reduce((a, b) => a + b, 0) : null,
    extra: resolved.filter(([, v]) => v === null).map(([t]) => t).join(' + '),
    roll: spell.test.roll,
  }
}

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

// One target per enhancement level: the score that leaves n x 4 SOPs after a
// hit. Level 0 is the plain hit.
export type EnhancementLevel = { level: number; target: number }

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
  enhancements: EnhancementLevel[] // empty when the spell has no enhancement or no DL
  modifications: { name: string; SOP: number; text: string }[]
  test: ResolvedTest | null
  damage: string // "20 blunt" already scaled by DM, "" when the spell deals none
  outcomes: { degree: string; text: string }[]
  range: string
  price: string
  costText: string
  description: string
  enhance: string
  canCast: boolean // in play, and the price can be met (or the spell is held and a click ends it)
  active: boolean // a sustained spell currently held
}

const ENHANCEMENT_LEVELS = [0, 1, 2, 3]

function rangeLabel(spell: Spell): string {
  return [
    spell.castRange && `cast ${spell.castRange}`,
    spell.castArea && `area ${spell.castArea}`,
    spell.effectRange && `effect ${spell.effectRange}`,
    spell.effectArea && `effect area ${spell.effectArea}`,
  ].filter(Boolean).join(' · ')
}

export function getSpellSheetRows(c: Character): SpellSheetRow[] {
  return (Object.keys(c.spells) as SpellKey[])
    .filter((key) => key in SPELLS)
    .map((key) => {
      const spell = SPELLS[key]
      const learned = c.spells[key]
      const hitAt = spell.DL === null ? null : spell.DL + HIT_MARGIN
      const enhancements = hitAt === null || !spell.enhance ? [] :
        ENHANCEMENT_LEVELS.map((level) => ({ level, target: hitAt + level * SPELL_MODIFICATIONS.enhance.SOP }))
      const damage = spell.damage === null ? '' :
        `${spell.damage.scaled ? Math.floor(spell.damage.value * getDM(c)) : spell.damage.value} ${spell.damage.kind}`
      const active = isSpellActive(c, key)
      const canCast = isCampaignCharacter(c) && (active || canAfford(c, spell.cost))
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
        hitAt,
        enhancements,
        modifications: Object.entries(SPELL_MODIFICATIONS).map(([name, m]) => ({ name, SOP: m.SOP, text: m.text })),
        test: resolveTest(c, spell),
        damage,
        outcomes: spell.outcomes === null ? [] :
          (['miss', 'graze', 'hit', 'crit'] as const).filter((d) => spell.outcomes![d]).map((d) => ({ degree: d, text: spell.outcomes![d] })),
        range: rangeLabel(spell),
        price: priceLabel(spell.cost),
        costText: spell.costText,
        description: spell.description,
        enhance: spell.enhance,
        canCast,
        active,
      }
    })
    .sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name))
}
