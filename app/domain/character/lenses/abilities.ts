import { requirementsLabel } from './requirements'
import type { Character, Cost } from '../../types'
import { ABILITIES, ABILITY_KEYS, AbilityKey } from '../../abilities'
import { isCampaignCharacter } from '../../utils'
import { canLearnAbility, getAbilityXPCost } from '../rules/abilities'
import { canAfford } from '../rules/cost'
import { getDrain, isAbilityActive } from '../rules/effects'

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
  usage: string // "passive", "2 AP + 1 STA", "sustained, 1 STA/turn"
  stages: AbilityStageView[]
  next: AbilityStageView | null // the stage a click would learn, if any
  top: AbilityStageView | null // the highest learned stage — the one a click would forget
  complete: boolean // every stage learned; otherwise a null `next` means the next stage is locked
  progress: string // "2/3" for a multi-stage family, "" otherwise
  toggle: AbilityStageView | null // the learned stage that carries the family's switch, if any
  active: boolean // whether that switch is on
  use: AbilityUseView | null // the learned stage that fires for a price, if any
}

export type AbilityUseView = {
  key: AbilityKey
  name: string
  price: string // "4 AP + 1 STA" — the cost that gates a use; instant drains are not part of it
  affordable: boolean // whether the character can pay it right now
}

function learningPrice(c: Character, key: AbilityKey): string {
  const { karma } = ABILITIES[key]
  if (karma) return `${karma} Karma`
  const xp = getAbilityXPCost(key)(c)
  return xp ? `${xp} XP` : ''
}

// How the ability is held, in the words the book used for its Usage field:
// always on, fired for a price, or switched on and paid per turn.
function usageLabel(key: AbilityKey): string {
  const ability = ABILITIES[key]
  switch (ability.activation) {
    case 'passive': return 'passive'
    case 'active': return priceLabel(ability.cost)
    case 'toggle': return `sustained, ${priceLabel(getDrain(ability.effect, 'end_round'))}/turn`
  }
}

function priceLabel(cost: Cost): string {
  const parts = []
  if (cost.AP) parts.push(`${cost.AP} AP`)
  if (cost.STA) parts.push(`${cost.STA} STA`)
  if (cost.exhaustion) parts.push(`${cost.exhaustion} exhaustion`)
  if (cost.IL) parts.push(`${cost.IL} IL`)
  if (cost.ET) parts.push(`${cost.ET} ET`)
  return parts.join(' + ') || 'free'
}

export function getAbilityCatalogRows(c: Character): AbilityFamilyView[] {
  const families = new Map<string, AbilityFamilyView>()
  for (const key of ABILITY_KEYS) {
    const ability = ABILITIES[key]
    const row = families.get(ability.family) ?? {
      family: ability.family,
      section: ability.section,
      usage: usageLabel(key),
      stages: [],
      next: null,
      top: null,
      complete: false,
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
    row.complete = row.stages.every((s) => s.learned)
    // Switches and triggers only exist in play — a base character has no
    // resources to spend and nothing to hold switched on.
    if (isCampaignCharacter(c)) {
      row.toggle = row.stages.find((s) => s.learned && ABILITIES[s.key].activation === 'toggle') ?? null
      row.active = row.toggle !== null && isAbilityActive(c, row.toggle.key)
      const usable = row.stages.find((s) => s.learned && ABILITIES[s.key].activation === 'active')
      if (usable) {
        const { cost } = ABILITIES[usable.key]
        row.use = { key: usable.key, name: usable.name, price: priceLabel(cost), affordable: canAfford(c, cost) }
      }
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
