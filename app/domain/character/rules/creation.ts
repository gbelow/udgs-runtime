import { ABILITIES, ABILITY_FAMILIES, ABILITY_FAMILY_OF, AbilityKey, FamilyKey, getAbilityLevel, getFamilyStages, heldAbility, isFamilyKey } from '../../abilities'
import { CREATION_PRIORITIES } from '../../tables'
import { AttributesSchema, Character, CreationDraft, ProficienciesSchema, Proficiencies, Skills, SkillsSchema, TalentsSchema, Trainables } from '../../types'
import { getAbilityXPCost, meetsAbilityRequirements } from './abilities'
import { emptyKnowledge } from './knowledge'
import { getConvictionSlot } from './requirements'
import { PROFICIENCY_TALENTS, SKILL_TALENTS, TalentKey, getAttributeRaisesXPCost, getProficiencyXPCost, getSkillXPCost, getTalentKarmaCost, getTrainableRaisePrice } from './learning'
import { getSM } from './size'
import { sumTerms, type Term } from './terms'

// creating.tex "Character Creation": XP from each talent focus, and karma,
// which starts at nothing and is only gained by taking flaws.
export type CreationPool = TalentKey | 'karma'
export const CREATION_POOLS: CreationPool[] = ['CON', 'SPI', 'INT', 'DEX', 'karma']

const ATTRIBUTE_KEYS = Object.keys(AttributesSchema.shape) as (keyof Trainables)[]
const TRAINABLE_KEYS = [...Object.keys(SkillsSchema.shape), ...Object.keys(ProficienciesSchema.shape), ...Object.keys(TalentsSchema.shape)] as (keyof Trainables)[]

const FAMILY_KEYS = Object.keys(ABILITY_FAMILIES) as FamilyKey[]

const isTalent = (key: keyof Trainables): key is TalentKey => key in TalentsSchema.shape

// The pool a trainable is bought from: a skill or proficiency from the XP of
// its talent, a talent with karma ("After that, talents can only be increased
// by spending karma"), an attribute from the CON XP (Step 4). Null for a skill
// the book does not let be trained on its own.
export function getCreationPool(key: keyof Trainables): CreationPool | null {
  if (key in SkillsSchema.shape) return SKILL_TALENTS[key as keyof Skills]
  if (key in ProficienciesSchema.shape) return PROFICIENCY_TALENTS[key as keyof Proficiencies]
  if (isTalent(key)) return 'karma'
  return 'CON'
}

const boughtOf = (d: CreationDraft, key: keyof Trainables): number => d.trainables[key] ?? 0

// The talent a priority gives its focus (Steps 4–7).
const priorityTalent = (d: CreationDraft, key: keyof Trainables): number => (isTalent(key) ? CREATION_PRIORITIES[d.priorities[key]].talent : 0)

// Where a talent's level comes from: the start the race gives (Step 1), its
// focus's priority (Steps 4–7) and the levels bought with karma. Empty for
// anything but a talent.
export function getCreationTalentTerms(d: CreationDraft, key: keyof Trainables): Term[] {
  if (!isTalent(key)) return []
  return [
    { label: `priority ${d.priorities[key]}`, value: priorityTalent(d, key) },
    { label: d.race?.name || 'race', value: d.character.trainables[key].value },
    { label: 'karma', value: boughtOf(d, key) },
  ]
}

// The character as bought: the start, the talents its priorities give, and
// every level and stage bought on top. The race's attribute bonuses are not
// in it — they come last (Step 1, "after step 4").
export function getCreationBuild(d: CreationDraft): Character {
  const c = d.character
  const trainables = { ...c.trainables }
  for (const key of Object.keys(trainables) as (keyof Trainables)[]) {
    const terms = getCreationTalentTerms(d, key)
    const value = terms.length ? sumTerms(terms) : trainables[key].value + boughtOf(d, key)
    if (value !== trainables[key].value) trainables[key] = { ...trainables[key], value }
  }
  const knowledges = { ...c.knowledges }
  for (const [name, levels] of Object.entries(d.knowledges)) {
    const held = knowledges[name] ?? emptyKnowledge(name)
    if (levels > 0) knowledges[name] = { ...held, value: held.value + levels }
  }
  const abilities = { ...c.abilities }
  for (const [family, stages] of Object.entries(d.abilities)) {
    if (isFamilyKey(family) && stages > 0) abilities[family] = heldAbility(family, getAbilityLevel(c, family) + stages)
  }
  return { ...c, trainables, knowledges, abilities }
}

// The character made: the build with the race's attribute bonuses on top.
export function getCreatedCharacter(d: CreationDraft): Character {
  const build = getCreationBuild(d)
  const trainables = { ...build.trainables }
  for (const key of ATTRIBUTE_KEYS) {
    const bonus = d.race?.bonuses[key as keyof typeof d.race.bonuses] ?? 0
    if (bonus) trainables[key] = { ...trainables[key], value: trainables[key].value + bonus }
  }
  return { ...build, trainables }
}

// What one purchase costs: a trainable by its key, the attributes together,
// an ability by its family.
export type CreationCharge = { key: string; pool: CreationPool; amount: number }

function sumLevels(from: number, count: number, price: (level: number) => number): number {
  let total = 0
  for (let level = from + 1; level <= from + count; level++) total += price(level)
  return total
}

function getTrainableCharge(d: CreationDraft, build: Character, key: keyof Trainables): CreationCharge | null {
  const pool = getCreationPool(key)
  const count = boughtOf(d, key)
  if (pool === null || count <= 0) return null
  const from = d.character.trainables[key].value + priorityTalent(d, key)
  const talent = pool === 'karma' ? 0 : build.trainables[pool].value
  const price = isTalent(key) ? getTalentKarmaCost
    : key in SkillsSchema.shape ? (level: number) => getSkillXPCost(level, talent)
    : (level: number) => getProficiencyXPCost(level, talent)
  return { key, pool, amount: sumLevels(from, count, price) }
}

// creating.tex "Learning Knowledge": learned as skills are, "using INT as the
// talent".
function getKnowledgeCharge(d: CreationDraft, build: Character, name: string): CreationCharge | null {
  const count = d.knowledges[name] ?? 0
  if (count <= 0) return null
  const from = d.character.knowledges[name]?.value ?? 0
  return { key: `knowledge:${name}`, pool: 'INT', amount: sumLevels(from, count, (level) => getSkillXPCost(level, build.trainables.INT.value)) }
}

// creating.tex "Improving attributes", bought from 8.
function getAttributesCharge(d: CreationDraft, build: Character): CreationCharge | null {
  const from = ATTRIBUTE_KEYS.map((key) => d.character.trainables[key].value)
  const to = ATTRIBUTE_KEYS.map((key, i) => from[i] + Math.max(0, boughtOf(d, key)))
  if (to.every((v, i) => v === from[i])) return null
  return { key: 'attributes', pool: 'CON', amount: getAttributeRaisesXPCost(from, to, build.trainables.CON.value, getSM(build)) }
}

// The stages bought of a family, each in its own price: karma (a flaw's
// negative karma is karma gained), or XP from the talent it lists. A stage the
// book lists at no cost charges nothing.
function getStageCharge(key: AbilityKey, build: Character): CreationCharge | null {
  const { karma, talent } = ABILITIES[key]
  const family = ABILITY_FAMILY_OF[key]
  if (karma) return { key: family, pool: 'karma', amount: karma }
  if (talent.length) return { key: family, pool: talent[0].property, amount: getAbilityXPCost(key)(build) }
  return null
}

const boughtStages = (d: CreationDraft, family: FamilyKey): AbilityKey[] => {
  const from = getAbilityLevel(d.character, family)
  return getFamilyStages(family).slice(from, from + (d.abilities[family] ?? 0))
}

export function getCreationCharges(d: CreationDraft): CreationCharge[] {
  const build = getCreationBuild(d)
  const families = Object.keys(d.abilities).filter(isFamilyKey)
  return [
    ...TRAINABLE_KEYS.map((key) => getTrainableCharge(d, build, key)),
    getAttributesCharge(d, build),
    ...Object.keys(d.knowledges).map((name) => getKnowledgeCharge(d, build, name)),
    ...families.flatMap((family) => boughtStages(d, family).map((key) => getStageCharge(key, build))),
  ].filter((charge): charge is CreationCharge => charge !== null)
}

// Each pool's budget against what is spent from it. Karma's budget is what
// the flaws taken give.
export type PoolBalance = { budget: number; spent: number }

export function getCreationBalances(d: CreationDraft): Record<CreationPool, PoolBalance> {
  const balances = Object.fromEntries(CREATION_POOLS.map((pool) => [pool, {
    budget: pool === 'karma' ? 0 : CREATION_PRIORITIES[d.priorities[pool]].XP,
    spent: 0,
  }])) as Record<CreationPool, PoolBalance>
  for (const { pool, amount } of getCreationCharges(d)) {
    if (amount < 0) balances[pool].budget -= amount
    else balances[pool].spent += amount
  }
  return balances
}

// creating.tex "Character Creation", Step 3: the gold the wealth focus gives.
export function getCreationGold(d: CreationDraft): number {
  return CREATION_PRIORITIES[d.priorities.wealth].gold
}

// What one more level of a trainable would leave its row costing more, in
// its pool, or null when it cannot rise: not trainable on its own, or at the
// book's limit.
export function getCreationRaise(d: CreationDraft, key: keyof Trainables): CreationCharge | null {
  const pool = getCreationPool(key)
  if (pool === null || getTrainableRaisePrice(key)(getCreatedCharacter(d)) === null) return null
  const raised = { ...d, trainables: { ...d.trainables, [key]: boughtOf(d, key) + 1 } }
  return rowRaise(d, raised, ATTRIBUTE_KEYS.includes(key) ? 'attributes' : key, pool)
}

// What one more level of a knowledge costs, from the INT XP.
export function getCreationKnowledgeRaise(d: CreationDraft, name: string): CreationCharge {
  const raised = { ...d, knowledges: { ...d.knowledges, [name]: (d.knowledges[name] ?? 0) + 1 } }
  return rowRaise(d, raised, `knowledge:${name}`, 'INT')
}

// The families whose next stage can be bought, each with that stage's price
// (null for a stage the book lists at no cost): every family with a next
// stage whose requirements the build meets.
export function getCreationAbilityRaises(d: CreationDraft): Partial<Record<FamilyKey, CreationCharge | null>> {
  const build = getCreationBuild(d)
  const raises: Partial<Record<FamilyKey, CreationCharge | null>> = {}
  for (const family of FAMILY_KEYS) {
    const next = getFamilyStages(family)[getAbilityLevel(build, family)]
    if (next && meetsAbilityRequirements(next)(build)) raises[family] = getStageCharge(next, build)
  }
  return raises
}

// What a purchase adds to the spend of its row: the attributes are one row,
// since a point's price turns on the others.
function rowRaise(d: CreationDraft, raised: CreationDraft, row: string, pool: CreationPool): CreationCharge {
  const spend = (draft: CreationDraft) => getCreationCharges(draft).filter((c) => c.key === row && c.pool === pool).reduce((sum, c) => sum + c.amount, 0)
  return { key: row, pool, amount: spend(raised) - spend(d) }
}

// What stands between the draft and a character: a pool spent past its
// budget, a stage bought whose requirements the build no longer meets, or a
// choice the book requires not made — the limit stress action ("Limit Stress
// Actions") and the two convictions ("Convictions").
export function getCreationProblems(d: CreationDraft): string[] {
  const balances = getCreationBalances(d)
  const build = getCreationBuild(d)
  const over = CREATION_POOLS.filter((pool) => balances[pool].spent > balances[pool].budget).map((pool) => `${pool} spent ${balances[pool].spent} of ${balances[pool].budget}`)
  const unmet = Object.keys(d.abilities).filter(isFamilyKey)
    .flatMap((family) => boughtStages(d, family))
    .filter((key) => !meetsAbilityRequirements(key)(build))
    .map((key) => `${ABILITIES[key].name}: requirements not met`)
  const { limitStress, trainables } = d.character
  const unchosen = [
    ...(limitStress ? [] : ['choose a limit stress action']),
    ...(getConvictionSlot(trainables.conviction1.name) === 'conviction1' ? [] : ['choose a temperament']),
    ...(getConvictionSlot(trainables.conviction2.name) === 'conviction2' ? [] : ['choose a worldview']),
  ]
  return [...over, ...unmet, ...unchosen]
}
