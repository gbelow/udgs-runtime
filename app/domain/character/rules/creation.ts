import { ABILITIES, ABILITY_FAMILIES, ABILITY_FAMILY_OF, AbilityKey, FamilyKey, getAbilityLevel, getFamilyStages, heldAbility, isFamilyKey } from '../../abilities'
import { CREATION_PRIORITIES } from '../../tables'
import { AttributesSchema, Character, CreationDraft, ProficienciesSchema, Proficiencies, Skills, SkillsSchema, SpellMethod, SpellMethodSchema, TalentsSchema, Trainables } from '../../types'
import { SPELLS, SPELL_KEYS, SpellKey, isSpellKey } from '../../spells'
import { getAbilityXPCost, meetsAbilityRequirements } from './abilities'
import { emptyKnowledge } from './knowledge'
import { getConvictionSlot } from './requirements'
import { canClaimFreeSpell, canLearnSpell, getFreeSpellCount } from './spells'
import { PROFICIENCY_TALENTS, SKILL_TALENTS, SPELL_LEARN_XP, TalentKey, getAttributeRaisesXPCost, getProficiencyXPCost, getSkillXPCost, getTalentKarmaCost, getTrainableRaisePrice } from './learning'
import { getSM } from './size'
import { getRacedCharacter } from './race'
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

// creating.tex "Character Creation", Step 1: where the character starts — the
// draft's own choices with the race on them. The race's talent bonuses count
// from the start, so every price is worked out with them; its attribute
// bonuses wait for the end ("Add the attribute bonuses after step 4").
export function getCreationStart(d: CreationDraft): Character {
  if (!d.race) return d.character
  const bonuses = Object.fromEntries(Object.entries(d.race.bonuses).filter(([key]) => isTalent(key as keyof Trainables)))
  return getRacedCharacter({ ...d.race, bonuses })(d.character)
}

// The stages of a family the race gives, and the stages bought on top: the
// draft keeps the level bought up to, so a stage the race comes to give costs
// nothing.
export function getRacialLevel(d: CreationDraft, family: FamilyKey): number {
  return getAbilityLevel(getCreationStart(d), family)
}

export function getBoughtStageCount(d: CreationDraft, family: FamilyKey): number {
  return Math.max(0, (d.abilities[family] ?? 0) - getRacialLevel(d, family))
}

// Where a talent's level comes from: the start the race gives (Step 1), its
// focus's priority (Steps 4–7) and the levels bought with karma. Empty for
// anything but a talent.
export function getCreationTalentTerms(d: CreationDraft, key: keyof Trainables): Term[] {
  return talentTerms(d, getCreationStart(d), key)
}

function talentTerms(d: CreationDraft, start: Character, key: keyof Trainables): Term[] {
  if (!isTalent(key)) return []
  return [
    { label: `priority ${d.priorities[key]}`, value: priorityTalent(d, key) },
    { label: d.race?.name || 'race', value: start.trainables[key].value },
    { label: 'karma', value: boughtOf(d, key) },
  ]
}

// The character as bought: the start, the talents its priorities give, and
// every level and stage bought on top. The race's attribute bonuses are not
// in it — they come last (Step 1, "after step 4").
export function getCreationBuild(d: CreationDraft): Character {
  const c = getCreationStart(d)
  const trainables = { ...c.trainables }
  for (const key of Object.keys(trainables) as (keyof Trainables)[]) {
    const terms = talentTerms(d, c, key)
    const value = terms.length ? sumTerms(terms) : trainables[key].value + boughtOf(d, key)
    if (value !== trainables[key].value) trainables[key] = { ...trainables[key], value }
  }
  const knowledges = { ...c.knowledges }
  for (const [name, levels] of Object.entries(d.knowledges)) {
    const held = knowledges[name] ?? emptyKnowledge(name)
    if (levels > 0) knowledges[name] = { ...held, value: held.value + levels }
  }
  const abilities = { ...c.abilities }
  for (const [family, level] of Object.entries(d.abilities)) {
    if (isFamilyKey(family) && level > getAbilityLevel(c, family)) abilities[family] = heldAbility(family, level)
  }
  const spells = { ...c.spells }
  for (const [key, { method }] of Object.entries(d.spells)) {
    if (!(key in spells)) spells[key] = { method, practice: 0 }
  }
  return { ...c, trainables, knowledges, abilities, spells }
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
  const from = getCreationStart(d).trainables[key].value + priorityTalent(d, key)
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

// A spell chosen costs 6 XP by any route (the user's ruling): from the INT
// XP, a cleric's from the SPI XP ("using devotion XP", creating.tex "Deities
// and Devotion"). A spell claimed free, or one the character starts with,
// costs nothing.
const spellCharge = (key: string, method: SpellMethod): CreationCharge =>
  ({ key: `spell:${key}`, pool: method === 'cleric' ? 'SPI' : 'INT', amount: SPELL_LEARN_XP })

function getSpellCharge(d: CreationDraft, key: string): CreationCharge | null {
  const chosen = d.spells[key]
  return !chosen || chosen.free || key in d.character.spells ? null : spellCharge(key, chosen.method)
}

const boughtStages = (d: CreationDraft, family: FamilyKey): AbilityKey[] =>
  getFamilyStages(family).slice(getRacialLevel(d, family), d.abilities[family] ?? 0)

export function getCreationCharges(d: CreationDraft): CreationCharge[] {
  const build = getCreationBuild(d)
  const families = Object.keys(d.abilities).filter(isFamilyKey)
  return [
    ...TRAINABLE_KEYS.map((key) => getTrainableCharge(d, build, key)),
    getAttributesCharge(d, build),
    ...Object.keys(d.knowledges).map((name) => getKnowledgeCharge(d, build, name)),
    ...families.flatMap((family) => boughtStages(d, family).map((key) => getStageCharge(key, build))),
    ...Object.keys(d.spells).map((key) => getSpellCharge(d, key)),
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

// The spells that can be chosen, each with the methods it can be learned by
// and the price by each: every spell not yet held whose requirements the
// build meets by that method (spells.tex "Learning spells").
export type CreationSpellRaises = Partial<Record<SpellKey, Partial<Record<SpellMethod, CreationCharge>>>>
export function getCreationSpellRaises(d: CreationDraft, build = getCreationBuild(d)): CreationSpellRaises {
  const raises: CreationSpellRaises = {}
  for (const key of SPELL_KEYS) {
    const methods = SpellMethodSchema.options.filter((method) => canLearnSpell(key, method)(build))
    if (methods.length) raises[key] = Object.fromEntries(methods.map((method) => [method, spellCharge(key, method)]))
  }
  return raises
}

// abilities.tex "Magic Theory": the spells the abilities bought let be taken
// free, and those not yet claimed.
export function getCreationFreeSpells(d: CreationDraft, build = getCreationBuild(d)): { total: number; left: number } {
  const total = getFreeSpellCount(build)
  return { total, left: total - Object.values(d.spells).filter((s) => s.free).length }
}

// Whether a spell can be claimed as one of them now.
export function canClaimCreationSpell(d: CreationDraft, key: SpellKey, build = getCreationBuild(d)): boolean {
  return getCreationFreeSpells(d, build).left > 0 && canClaimFreeSpell(key)(build)
}

// Whether the build, the spell taken out of it, could still learn a spell
// as it was chosen.
function canKeepSpell(build: Character, key: SpellKey, { method, free }: CreationDraft['spells'][string]): boolean {
  const { [key]: _chosen, ...spells } = build.spells
  const without = { ...build, spells }
  return free ? canClaimFreeSpell(key)(without) : canLearnSpell(key, method)(without)
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
  const unlearnable = Object.entries(d.spells).flatMap(([key, chosen]) =>
    isSpellKey(key) && !(key in d.character.spells) && !canKeepSpell(build, key, chosen)
      ? [`${SPELLS[key].name}: cannot be learned ${chosen.free ? 'free' : `as ${chosen.method}`}`]
      : [])
  const { total, left } = getCreationFreeSpells(d, build)
  const overclaimed = left < 0 ? [`free spells: ${total - left} claimed of ${total}`] : []
  const { limitStress, trainables } = d.character
  const unchosen = [
    ...(limitStress ? [] : ['choose a limit stress action']),
    ...(getConvictionSlot(trainables.conviction1.name) === 'conviction1' ? [] : ['choose a temperament']),
    ...(getConvictionSlot(trainables.conviction2.name) === 'conviction2' ? [] : ['choose a worldview']),
  ]
  return [...over, ...unmet, ...unlearnable, ...overclaimed, ...unchosen]
}
