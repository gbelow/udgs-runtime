import { ABILITIES, ABILITY_FAMILIES, FamilyKey, getAbilityLevel, isAbilityKey } from '../../abilities'
import { AttributesSchema, FOCI, ProficienciesSchema, SkillsSchema, TalentsSchema, type CreationDraft, type Focus, type Priority, SpellMethodSchema, type SpellMethod, type Trainables } from '../../types'
import { ABILITY_SECTIONS, knowledges_list, type LimitStressAction } from '../../lists'
import { getAbilityCatalogRows, type AbilityFamilyView } from './abilities'
import { getSpellCatalogRows, type SpellCatalogRow } from './spells'
import { sumTerms, type Term } from '../rules/terms'
import { groupBy, type Group } from '../../utils'
import { getStartingWealthView, type StartingWealthView } from '../../item/projections/money'
import { getConvictionLevel, getConvictionSlot } from '../rules/requirements'
import { CREATION_POOLS, getCreationKnowledgeRaise, getCreatedCharacter, getCreationTalentTerms, getCreationAbilityRaises, getCreationBalances, getCreationGold, getCreationPool, getCreationProblems, getCreationRaise, getCreationSpellRaises, getCreationFreeSpells, canClaimCreationSpell, getCreationBuild, getBoughtStageCount, getRacialLevel, type CreationPool } from '../rules/creation'

// What buying the next level costs: its pool and amount; free for a stage the
// book lists at no cost; null when it cannot be bought.
export type CreationPrice = { pool: CreationPool | null; amount: number } | null

// `terms`: where the level comes from, for a talent; empty otherwise.
export type CreationRow = { key: keyof Trainables; name: string; value: number; bought: number; next: CreationPrice; terms: Term[] }
export type CreationKnowledgeRow = { name: string; value: number; bought: number; next: CreationPrice }
// The talent a focus ends with: its priority, the race's bonus and the karma
// bought, each a term, and their sum.
export type CreationTalent = { total: number; terms: Term[] }
// The race the character is made from, as a preset: its bonuses and the
// abilities it starts with.
export type CreationRaceView = { name: string; bonuses: Term[]; abilities: string[] }

// One ability family as the creation tab shows it: its text and stages, the
// level held, the stages the race gives (locked) and those bought on top, and
// the price of its next stage (null when it cannot be bought now).
export type CreationAbilityEntry = { family: FamilyKey; view: AbilityFamilyView; level: number; racial: number; bought: number; next: CreationPrice }

// One spell as the creation tab shows it: its catalog entry, the method it
// was chosen by (null while not chosen), whether it was claimed free or can
// be now, its price by each method it can be learned by now, and why it
// cannot be taken at all ('' when it can).
export type CreationSpellEntry = {
  row: SpellCatalogRow
  method: SpellMethod | null
  free: boolean
  claimable: boolean
  prices: Partial<Record<SpellMethod, CreationPrice>>
  locked: string
}

// creating.tex "Character Creation" as the creation tab shows it: the
// priorities, each pool against its budget, the gold, what can be bought
// with its next price, and what keeps the character from being made.
export type CreationPanelView = {
  name: string
  race: CreationRaceView | null
  limitStress: LimitStressAction | null
  temperament: string
  worldview: string
  priorities: { focus: Focus; priority: Priority; talent: CreationTalent | null }[] // the talent a focus ends with; none for wealth
  pools: { pool: CreationPool; budget: number; spent: number; over: boolean }[]
  gold: number
  wealth: StartingWealthView | null // the gold against the gear carried
  groups: { label: string; rows: CreationRow[] }[]
  knowledges: CreationKnowledgeRow[]
  abilities: CreationAbilityEntry[] // the families held, racial or bought
  abilityCatalog: Group<CreationAbilityEntry>[] // the sections offered, in the book's order
  spells: CreationSpellEntry[] // the spells chosen
  freeSpells: { total: number; left: number } // abilities.tex "Magic Theory"
  spellCatalog: Group<CreationSpellEntry>[] // by school, in the catalog's order
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

function getTalent(d: CreationDraft, focus: Focus): CreationTalent | null {
  if (!(focus in TalentsSchema.shape)) return null
  const terms = getCreationTalentTerms(d, focus as keyof Trainables).filter((term) => term.value !== 0)
  return { total: sumTerms(terms), terms }
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
      return { family, view, level: getAbilityLevel(created, family), racial: getRacialLevel(d, family), bought: getBoughtStageCount(d, family), next: stagePrice(family) }
    })
  const build = getCreationBuild(d)
  const spellRaises = getCreationSpellRaises(d, build)
  const spellEntries: CreationSpellEntry[] = getSpellCatalogRows(created).map((row) => {
    const chosen = d.spells[row.key]
    const claimable = canClaimCreationSpell(d, row.key, build)
    const prices = spellRaises[row.key] ?? {}
    const open = chosen || claimable || Object.keys(prices).length
    return {
      row,
      method: chosen?.method ?? null,
      free: chosen?.free ?? false,
      claimable,
      prices,
      locked: open ? '' : [...new Set(SpellMethodSchema.options.map((method) => row.blocked[method]))].join(' · '),
    }
  })
  return {
    name: d.character.name,
    race: getRaceView(d),
    limitStress: d.character.limitStress,
    temperament: d.character.trainables.conviction1.name,
    worldview: d.character.trainables.conviction2.name,
    priorities: FOCI.map((focus) => ({ focus, priority: d.priorities[focus], talent: getTalent(d, focus) })),
    pools: CREATION_POOLS.map((pool) => ({ pool, ...balances[pool], over: balances[pool].spent > balances[pool].budget })),
    gold: getCreationGold(d),
    wealth: getStartingWealthView(created),
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
    abilities: entries.filter((entry) => entry.level > 0),
    abilityCatalog: ABILITY_SECTIONS.filter(offered)
      .map((label) => ({ label, rows: entries.filter((entry) => entry.view.section === label) }))
      .filter(({ rows }) => rows.length),
    spells: spellEntries.filter((entry) => entry.method !== null),
    freeSpells: getCreationFreeSpells(d, build),
    spellCatalog: groupBy(spellEntries, (entry) => entry.row.section),
    problems: getCreationProblems(d),
  }
}
