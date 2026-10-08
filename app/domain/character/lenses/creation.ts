import { ABILITIES, ABILITY_FAMILIES, FamilyKey, getAbilityLevel, isAbilityKey, isFamilyKey } from '../../abilities'
import { AttributesSchema, FOCI, ProficienciesSchema, SkillsSchema, TalentsSchema, type CreationDraft, type Focus, type Priority, type Trainables } from '../../types'
import { ABILITY_SECTIONS, knowledges_list, type LimitStressAction } from '../../lists'
import { getAbilityCatalogRows, type AbilityFamilyView } from './abilities'
import type { Term } from '../rules/terms'
import { getConvictionLevel, getConvictionSlot } from '../rules/requirements'
import { CREATION_POOLS, getCreationKnowledgeRaise, getCreatedCharacter, getCreationTalentTerms, getCreationAbilityRaises, getCreationBalances, getCreationGold, getCreationPool, getCreationProblems, getCreationRaise, type CreationPool } from '../rules/creation'

// What buying the next level costs: its pool and amount; free for a stage the
// book lists at no cost; null when it cannot be bought.
export type CreationPrice = { pool: CreationPool | null; amount: number } | null

// `terms`: where the level comes from, for a talent; empty otherwise.
export type CreationRow = { key: keyof Trainables; name: string; value: number; bought: number; next: CreationPrice; terms: Term[] }
export type CreationKnowledgeRow = { name: string; value: number; bought: number; next: CreationPrice }
// The race the character is made from, as a preset: its bonuses and the
// abilities it starts with.
export type CreationRaceView = { name: string; bonuses: Term[]; abilities: string[] }

// One family of the catalog, as the creation tab browses it: its text and
// stages, the price of its next stage (null when it cannot be bought now),
// whether it can be added from the catalog, and whether it is already held.
export type CreationCatalogEntry = { family: FamilyKey; view: AbilityFamilyView; next: CreationPrice; addable: boolean; taken: boolean }
export type CreationCatalogSection = { section: string; entries: CreationCatalogEntry[] }

export type CreationStageRow = { family: FamilyKey; name: string; value: number; bought: number; next: CreationPrice }

// creating.tex "Character Creation" as the creation tab shows it: the
// priorities, each pool against its budget, the gold, what can be bought
// with its next price, and what keeps the character from being made.
export type CreationPanelView = {
  name: string
  race: CreationRaceView | null
  limitStress: LimitStressAction | null
  temperament: string
  worldview: string
  priorities: { focus: Focus; priority: Priority }[]
  pools: { pool: CreationPool; budget: number; spent: number; over: boolean }[]
  gold: number
  groups: { label: string; rows: CreationRow[] }[]
  knowledges: CreationKnowledgeRow[]
  abilities: CreationStageRow[]
  abilityCatalog: CreationCatalogSection[] // the sections offered, in the book's order
  problems: string[]
}

const keysOf = (shape: object) => Object.keys(shape) as (keyof Trainables)[]

const GROUPS: { label: string; keys: (keyof Trainables)[] }[] = [
  { label: 'Attributes', keys: keysOf(AttributesSchema.shape) },
  { label: 'Talents', keys: keysOf(TalentsSchema.shape) },
  { label: 'Proficiencies', keys: keysOf(ProficienciesSchema.shape) },
  { label: 'Skills', keys: keysOf(SkillsSchema.shape).filter((key) => getCreationPool(key) !== null) },
]

const familyName = (family: FamilyKey): string => ABILITY_FAMILIES[family].family
const FAMILY_BY_NAME = new Map((Object.keys(ABILITY_FAMILIES) as FamilyKey[]).map((family) => [familyName(family), family]))
const KNOWLEDGES = new Set(knowledges_list)

function getRaceView(d: CreationDraft): CreationRaceView | null {
  if (!d.race) return null
  return {
    name: d.race.name,
    bonuses: Object.entries(d.race.bonuses).flatMap(([label, value]) => (value ? [{ label, value }] : [])),
    abilities: d.race.abilities.map((key) => (isAbilityKey(key) ? ABILITIES[key].name : key)),
  }
}

export function getCreationPanel(d: CreationDraft): CreationPanelView {
  const created = getCreatedCharacter(d)
  const balances = getCreationBalances(d)
  const raises = getCreationAbilityRaises(d)
  const stagePrice = (family: FamilyKey): CreationPrice => (family in raises ? (raises[family] ?? { pool: null, amount: 0 }) : null)
  // A section named after a knowledge is offered once the character has a
  // level in that knowledge, one named after a conviction once it has adopted
  // that conviction.
  const offered = (section: string): boolean => {
    if (getConvictionSlot(section)) return getConvictionLevel(created, section) !== null
    const knowledge = section.toLowerCase()
    return !KNOWLEDGES.has(knowledge) || (created.knowledges[knowledge]?.value ?? 0) > 0
  }
  const entries = getAbilityCatalogRows(created)
    .sort((a, b) => a.family.localeCompare(b.family))
    .map((view) => {
      const family = FAMILY_BY_NAME.get(view.family)!
      return { family, view, next: stagePrice(family), addable: family in raises && !(family in d.abilities), taken: getAbilityLevel(created, family) > 0 }
    })
  return {
    name: d.character.name,
    race: getRaceView(d),
    limitStress: d.character.limitStress,
    temperament: d.character.trainables.conviction1.name,
    worldview: d.character.trainables.conviction2.name,
    priorities: FOCI.map((focus) => ({ focus, priority: d.priorities[focus] })),
    pools: CREATION_POOLS.map((pool) => ({ pool, ...balances[pool], over: balances[pool].spent > balances[pool].budget })),
    gold: getCreationGold(d),
    groups: GROUPS.map(({ label, keys }) => ({
      label,
      rows: keys.map((key) => ({
        key,
        name: created.trainables[key].name,
        value: created.trainables[key].value,
        bought: d.trainables[key] ?? 0,
        next: getCreationRaise(d, key),
        terms: getCreationTalentTerms(d, key),
      })),
    })),
    knowledges: knowledges_list.map((name) => ({
      name,
      value: created.knowledges[name]?.value ?? 0,
      bought: d.knowledges[name] ?? 0,
      next: getCreationKnowledgeRaise(d, name),
    })),
    abilities: Object.keys(d.abilities).filter(isFamilyKey).map((family) => ({
      family,
      name: familyName(family),
      value: getAbilityLevel(created, family),
      bought: d.abilities[family] ?? 0,
      next: stagePrice(family),
    })),
    abilityCatalog: ABILITY_SECTIONS.filter(offered)
      .map((section) => ({ section, entries: entries.filter((entry) => entry.view.section === section) }))
      .filter(({ entries }) => entries.length),
    problems: getCreationProblems(d),
  }
}
