import { Character, Requirement } from '../../types'
import { ABILITIES, ABILITY_KEYS, AbilityKey } from '../../abilities'
import { SPELLS, SpellKey } from '../../spells'
import { isAbilityActive } from './effects'
import { getAGI, getSTA, getSTR } from './characteristics'
import { isCampaignCharacter } from '../../utils'

const ATTRIBUTE = { STR: getSTR, AGI: getAGI, STA: getSTA } as const

// One item of an ability's requirements, as far as the domain can see it.
// Trainable levels are the book's words (a skill, a knowledge, a conviction)
// with no fixed home on the character yet, and gear and conditions are the
// table's to judge — those hold until the domain can read them.
function holdsRequirement(c: Character, req: Requirement): boolean {
  switch (req.kind) {
    case 'ability': return c.abilities.includes(req.name) !== req.not
    case 'spell': return (req.name in c.spells) !== req.not
    case 'attribute': return compare(ATTRIBUTE[req.name as keyof typeof ATTRIBUTE]?.(c) ?? 0, req.op, req.level) !== req.not
    case 'trainable':
    case 'gear':
    case 'condition':
      return true
  }
}

function compare(value: number, op: Requirement['op'], threshold: number): boolean {
  switch (op) {
    case '>': return value > threshold
    case '<': return value < threshold
    case '>=': return value >= threshold
    case '<=': return value <= threshold
  }
}

// abilities.tex "Acquiring abilities": "It is not possible to acquire an
// ability unless the requirements are met" and each is acquired once. Every
// listed item is needed and any alternative within an item satisfies it.
export function canLearnAbility(key: AbilityKey): (c: Character) => boolean {
  return (c: Character) =>
    !c.abilities.includes(key) &&
    ABILITIES[key].requires.every((req) => c.abilities.includes(req)) &&
    ABILITIES[key].requirements.every((item) => item.some((alt) => holdsRequirement(c, alt)))
}

// creating.tex "Talent and Learning": the XP price doubles for every level
// the training level sits above the character's talent. A karma-priced
// ability costs no XP.
export function getAbilityXPCost(key: AbilityKey): (c: Character) => number {
  return (c: Character) => {
    const { XPcost, talent } = ABILITIES[key]
    const shortfall = talent.reduce((worst, t) => Math.max(worst, t.level - c.trainables[t.property].value), 0)
    return XPcost * 2 ** shortfall
  }
}

export type AbilityStageView = {
  key: AbilityKey
  name: string
  stage: number
  learned: boolean
  learnable: boolean
  description: string
  price: string // "12 XP", "4 Karma", "" for a free stage
  requirements: string // "Archer, Riding I · Medicine 1", in the book's words
}

// One row per family, its stages in order, so the sidebar can show "Sprinter"
// once and let the reader step through I, II, III.
export type AbilityFamilyView = {
  family: string
  section: string
  usage: string
  stages: AbilityStageView[]
  next: AbilityStageView | null // the stage a click would learn, if any
  top: AbilityStageView | null // the highest learned stage — the one a click would forget
  progress: string // "2/3" for a multi-stage family, "" otherwise
  toggle: AbilityStageView | null // the learned stage that carries the family's switch, if any
  active: boolean // whether that switch is on
  use: AbilityUseView | null // the learned stage that fires for a price, if any
}

export type AbilityUseView = {
  key: AbilityKey
  name: string
  price: string // "4 AP + 1 STA"
}

function learningPrice(c: Character, key: AbilityKey): string {
  const { karma } = ABILITIES[key]
  if (karma) return `${karma} Karma`
  const xp = getAbilityXPCost(key)(c)
  return xp ? `${xp} XP` : ''
}

function requirementLabel(req: Requirement): string {
  const name = req.kind === 'ability' ? ABILITIES[req.name as AbilityKey].name
    : req.kind === 'spell' ? SPELLS[req.name as SpellKey].name
    : req.kind === 'trainable' ? `${req.name} ${req.level}`
    : req.kind === 'attribute' ? `${req.name} ${req.op} ${req.level}`
    : req.name
  return req.not ? `not ${name}` : name
}

function requirementsLabel(requirements: Requirement[][]): string {
  return requirements.map((item) => item.map(requirementLabel).join(' or ')).join(' · ')
}

function priceLabel(cost: { AP: number; STA: number }): string {
  const parts = []
  if (cost.AP) parts.push(`${cost.AP} AP`)
  if (cost.STA) parts.push(`${cost.STA} STA`)
  return parts.join(' + ') || 'free'
}

export function getAbilityCatalogRows(c: Character): AbilityFamilyView[] {
  const families = new Map<string, AbilityFamilyView>()
  for (const key of ABILITY_KEYS) {
    const ability = ABILITIES[key]
    const row = families.get(ability.family) ?? {
      family: ability.family,
      section: ability.section,
      usage: ability.usage,
      stages: [],
      next: null,
      top: null,
      progress: '',
      toggle: null,
      active: false,
      use: null,
    }
    const learned = c.abilities.includes(key)
    const stage: AbilityStageView = {
      key,
      name: ability.name,
      stage: ability.stage,
      learned,
      learnable: canLearnAbility(key)(c),
      description: ability.description,
      price: learningPrice(c, key),
      requirements: requirementsLabel(ability.requirements),
    }
    row.stages.push(stage)
    families.set(ability.family, row)
  }
  for (const row of families.values()) {
    row.stages.sort((a, b) => a.stage - b.stage)
    row.next = row.stages.find((s) => s.learnable) ?? null
    row.top = row.stages.filter((s) => s.learned).at(-1) ?? null
    // Switches and triggers only exist in play — a base character has no
    // resources to spend and nothing to hold switched on.
    if (isCampaignCharacter(c)) {
      row.toggle = row.stages.find((s) => s.learned && ABILITIES[s.key].activation === 'toggle') ?? null
      row.active = row.toggle !== null && isAbilityActive(c, row.toggle.key)
      const usable = row.stages.find((s) => s.learned && ABILITIES[s.key].activation === 'active')
      row.use = usable ? { key: usable.key, name: usable.name, price: priceLabel(ABILITIES[usable.key].cost) } : null
    }
    // A conviction's stages are its levels and may start at 0, so progress
    // reads the stage number rather than a count of stages.
    if (row.stages.length > 1) row.progress = `${row.top?.stage ?? 0}/${row.stages.at(-1)!.stage}`
  }
  return [...families.values()]
}

// The character's own abilities, collapsed the same way: one row per family
// with every stage's text kept, so the sheet reads "Keen Eyes 2/3" and a step
// back is a click on the top stage.
export function getLearnedAbilityRows(c: Character): AbilityFamilyView[] {
  return getAbilityCatalogRows(c).filter((row) => row.top !== null)
}

