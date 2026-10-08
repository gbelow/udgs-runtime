import { ABILITY_FAMILIES, FamilyKey, getAbilityLevel, isFamilyKey } from '../../abilities'
import { AttributesSchema, FOCI, ProficienciesSchema, SkillsSchema, TalentsSchema, type CreationDraft, type Focus, type Priority, type Trainables } from '../../types'
import { knowledges_list } from '../../lists'
import { CREATION_POOLS, getCreationKnowledgeRaise, getCreatedCharacter, getCreationAbilityRaises, getCreationBalances, getCreationGold, getCreationPool, getCreationProblems, getCreationRaise, type CreationPool } from '../rules/creation'

// What buying the next level costs: its pool and amount; free for a stage the
// book lists at no cost; null when it cannot be bought.
export type CreationPrice = { pool: CreationPool | null; amount: number } | null

export type CreationRow = { key: keyof Trainables; name: string; value: number; bought: number; next: CreationPrice }
export type CreationKnowledgeRow = { name: string; value: number; bought: number; next: CreationPrice }
export type CreationStageRow = { family: FamilyKey; name: string; value: number; bought: number; next: CreationPrice }

// creating.tex "Character Creation" as the creation tab shows it: the
// priorities, each pool against its budget, the gold, what can be bought
// with its next price, and what keeps the character from being made.
export type CreationPanelView = {
  race: string | null
  priorities: { focus: Focus; priority: Priority }[]
  pools: { pool: CreationPool; budget: number; spent: number; over: boolean }[]
  gold: number
  groups: { label: string; rows: CreationRow[] }[]
  knowledges: CreationKnowledgeRow[]
  abilities: CreationStageRow[]
  abilityOptions: { family: FamilyKey; name: string; next: CreationPrice }[]
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

export function getCreationPanel(d: CreationDraft): CreationPanelView {
  const created = getCreatedCharacter(d)
  const balances = getCreationBalances(d)
  const raises = getCreationAbilityRaises(d)
  const stagePrice = (family: FamilyKey): CreationPrice => (family in raises ? (raises[family] ?? { pool: null, amount: 0 }) : null)
  return {
    race: d.race?.name ?? null,
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
    abilityOptions: (Object.keys(raises) as FamilyKey[])
      .filter((family) => !(family in d.abilities))
      .map((family) => ({ family, name: familyName(family), next: stagePrice(family) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    problems: getCreationProblems(d),
  }
}
