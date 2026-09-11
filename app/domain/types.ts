import { z } from 'zod'
import { AFFLICTIONS } from './tables'
import { parseWeaponProperties } from './weaponProperties'

const num = z.number()
const str = z.string()

export const ArmorSchema = z.object({
  name: z.string().default('Skin'),
  RES: z.number().default(0),
  RESlayer: z.number().default(0),
  // TGH: z.number().default(0),
  INS: z.number().default(0),
  // poise: z.number().default(0),
  protection: z.number().default(0),
  deflection: z.number().default(4), // gear.tex "Armors": the Skin row deflects at +4, so an unarmoured default is not 0
  penalty: z.number().default(0),
  properties: str.default(''),
  notes: z.string().default(''),
}).strip()

export type Armor = z.infer<typeof ArmorSchema>

export const TrainableTypeSchema = z.enum(['skill', 'attribute', 'talent', 'proficiency', 'knowledge'])
export type TrainableType = z.infer<typeof TrainableTypeSchema>

export const TrainableSchema = z.object({
  value: z.number().default(0),
  name: z.string().default(''),
  XP: z.number().default(0),
  talent: z.string().default(''),
  type: TrainableTypeSchema.default('skill'),
}).strip()
export type Trainable = z.infer<typeof TrainableSchema>

// small helper so the group schemas aren't a wall of repeated defaults
const trainable = (type: TrainableType, value = 0, name: string) =>
  TrainableSchema.default({ value, name, XP: 0, talent: '', type })

// ── groups (each is a subset type on its own) ───────────
export const SkillsSchema = z.object({
  strike: trainable('skill', 0, 'Strike'),
  defend: trainable('skill', 0, 'Defend'),
  reflex: trainable('skill', 0, 'Reflex'),
  accuracy: trainable('skill', 0, 'Accuracy'),
  grapple: trainable('skill', 0, 'Grapple'),
  SD: trainable('skill', 0, 'SD'),
  stealth: trainable('skill', 0, 'Stealth'),
  prestidigitation: trainable('skill', 0, 'Prestidigitation'),
  balance: trainable('skill', 0, 'Balance'),
  detection: trainable('skill', 0, 'Detection'),
  health: trainable('skill', 0, 'Health'),
  force: trainable('skill', 0, 'Force'),
  swim: trainable('skill', 0, 'Swim'),
  climb: trainable('skill', 0, 'Climb'),
  explore: trainable('skill', 0, 'Explore'),
  cunning: trainable('skill', 0, 'Cunning'),
  will: trainable('skill', 0, 'Will'),
  persuasion: trainable('skill', 0, 'Persuasion'),
  deception: trainable('skill', 0, 'Deception'),
  insight: trainable('skill', 0, 'Insight'),
}).strip()
export type Skills = z.infer<typeof SkillsSchema>

export const AttributesSchema = z.object({
  STR: trainable('attribute', 10, 'Strength'),
  AGI: trainable('attribute', 10, 'Agility'),
  STA: trainable('attribute', 10, 'Stamina'),
}).strip()
export type Attributes = z.infer<typeof AttributesSchema>

export const TalentsSchema = z.object({
  CON: trainable('talent', 0, 'Constitution'),
  INT: trainable('talent', 0, 'Intelligence'),
  SPI: trainable('talent', 0, 'Spirit'),
  DEX: trainable('talent', 0, 'Dexterity'),
}).strip()
export type Talents = z.infer<typeof TalentsSchema>

export const ProficienciesSchema = z.object({
  melee: trainable('proficiency', 0, 'Melee'),
  ranged: trainable('proficiency', 0, 'Ranged'),
  awareness: trainable('proficiency', 0, 'Awareness'),
  sorcery: trainable('proficiency', 0, 'Sorcery'),
  conviction1: trainable('proficiency', 0, 'Conviction 1'),
  conviction2: trainable('proficiency', 0, 'Conviction 2'),
  devotion: trainable('proficiency', 0, 'Devotion'),
  charisma: trainable('proficiency', 0, 'Charisma'),
}).strip()

export type Proficiencies = z.infer<typeof ProficienciesSchema>

// Knowledges are open-ended (players can invent arbitrary ones, e.g. a
// specific town or how to ride a specific animal), so the key set can't be a
// closed schema like the other trainable groups — it's a plain string-keyed
// map, kept off the closed TrainablesSchema union. Missing keys default to 0
// via getKnowledgeValue, same as an untrained fixed skill would.
export const KnowledgesSchema = z.record(z.string(), TrainableSchema).default({})
export type Knowledges = z.infer<typeof KnowledgesSchema>

// ── merged whole ────────────────────────────────────────
export const TrainablesSchema = SkillsSchema
  .merge(AttributesSchema)
  .merge(TalentsSchema)
  .merge(ProficienciesSchema)

export type Trainables = z.infer<typeof TrainablesSchema>

export const CharacteristicsSchema = AttributesSchema
  .merge(TalentsSchema)
  .merge(ProficienciesSchema)

export type Characteristics = z.infer<typeof CharacteristicsSchema>

export const MovementSchema = z.object({
  basic: num.default(1),
  careful: num.default(0.5),
  crawl: num.default(0.33),
  run: num.default(0),
  jump: num.default(0),
  swim: num.default(0.33),
  'fast swim': num.default(0.5),
  stand: num.default(0),
}).strip()

export type Movement = z.infer<typeof MovementSchema>

export const WeaponAttackSchema = z.object({
  type: str.default('melee'),
  handed: str.default('small'),

  blunt: num.default(0),
  cut: num.default(0),
  STRmod: num.default(0),
  heavyMod: num.default(0),

  range: str.default('short'),

  RES: num.default(0),
  RESmod: num.default(0),

  AP: num.default(0),
  reload: num.default(0),
  deflection: num.default(0),

  // gear.tex prints properties as one comma-separated cell per attack row, and
  // the asset mirrors that verbatim so it stays diffable against the book.
  properties: str.default(''),
}).strip()
  // Parsed once, here, so no consumer ever string-matches on `properties`.
  // `.strip()` drops a serialized `props` before this runs, so the derived
  // value is always recomputed from the authored string and cannot go stale.
  .transform((atk) => ({ ...atk, props: parseWeaponProperties(atk.properties) }))

export type WeaponAttack = z.infer<typeof WeaponAttackSchema>

export const WeaponSchema = z.object({
  name: str.default(''),
  penalty: num.default(0),
  scale: num.default(3),
  attacks: z.array(WeaponAttackSchema).default([]),
}).strip()

export type Weapon = z.infer<typeof WeaponSchema>

export const ItemSchema = z.object({
  id: str.default(() => crypto.randomUUID()),
  name: str.default(''), // with no refId, this + description is all that says what the item is
  description: str.default(''),
  type: str.default('misc'), // which catalog refId resolves in, e.g. 'weapon' -> weapons.json, 'armor' -> armors.json
  amount: num.default(1),
  bulk: num.default(0), // 0 small · 1 medium · 2 large · 3+ cargo
  refId: str.default(''), // key into the type's catalog; empty means this item is pure flavor, no linked object
}).strip()

export type Item = z.infer<typeof ItemSchema>

export const ContainerKindSchema = z.enum(['belt', 'backpack', 'transport'])
export type ContainerKind = z.infer<typeof ContainerKindSchema>

export const ContainerSchema = z.object({
  name: str.default(''),
  kind: ContainerKindSchema.default('backpack'),
  numSlots: num.default(0),
  slotBulk: num.default(0), // bulk ladder position one slot accepts
  penalty: num.default(0),
  liftThreshold: z.object({ // narrow per-container exception (e.g. Large Backpack's "STR 15 or size 4" footnote) — most containers omit this
    STR: num.optional(),
    size: num.optional(),
  }).optional(),
  items: z.array(ItemSchema).default([]),
}).strip()

export type Container = z.infer<typeof ContainerSchema>

export const InjuriesSchema = z.object({
  injuryLevel: z.number().default(0),
  wounds: z.array(num).default([]),
  hemorrhage: z.number().default(0),
  potion: z.number().default(0),
  injuryThreshold: z.number().default(10),
  unconsciousThreshold: z.number().default(40),
  deathThreshold: z.number().default(50),
}).strip()

export type Injuries = z.infer<typeof InjuriesSchema>

export const WoundSchema = z.object({
  severity: z.number().default(0),
  location: z.string().default(''),
  description: z.string().default(''),
}).strip()

export type Wound = z.infer<typeof WoundSchema>

export const ResourcesSchema = z.object({
  AP: num.default(0),
  STA: num.default(0),
  hunger: num.default(0),
  thirst: num.default(0),
  exhaustion: num.default(0),
}).strip()

export type Resources = z.infer<typeof ResourcesSchema>

// Mirrors `AfflictionDef` in tables.ts — the penalty categories combat.tex
// names, plus the severity-ladder marker.
export const AfflictionItemSchema = z.object({
  sensory: num.optional(),
  mental: num.optional(),
  health: num.optional(),
  group: str.optional(),
  rank: num.optional(),
  controlable: z.boolean().default(false),
}).strip()

export type AfflictionItem = z.infer<typeof AfflictionItemSchema>

export const CharacterAfflictionsSchema =
  z.array(z.string()).default([])

export type CharacterAfflictions =
  z.infer<typeof CharacterAfflictionsSchema>

export type AfflictionKey = keyof typeof AFFLICTIONS

const AfflictionKeySchema =
  z.enum(Object.keys(AFFLICTIONS) as [AfflictionKey, ...AfflictionKey[]])

export const SenseSchema = z.object({
  name: z.string().default(''),
  rangePenalty: z.number().default(5),
  bonus: z.number().default(0),
  active: z.boolean().default(true),
  hasSense: z.boolean().default(true),
}).strip()

export type Sense = z.infer<typeof SenseSchema>

export const SensesSchema = z.object({
  vision: SenseSchema.default({ name: 'Vision', active: true, rangePenalty: 2, bonus: 0, hasSense: true }),
  hearing: SenseSchema.default({ name: 'Hearing', active: false, rangePenalty: 5, bonus: 0, hasSense: true }),
  smell: SenseSchema.default({ name: 'Smell', active: false, rangePenalty: 5, bonus: 0, hasSense: true }),
  touch: SenseSchema.default({ name: 'Touch', active: true, rangePenalty: 100, bonus: 0, hasSense: true }),
  synesthesia: SenseSchema.default({ name: 'Synesthesia', active: true, rangePenalty: 100, bonus: 0, hasSense: false }),
}).strip()

export type Senses = z.infer<typeof SensesSchema>

export const CostSchema = z.object({
  AP: num.default(0),
  STA: num.default(0),
  exhaustion: num.default(0),
  IL: num.default(0), // causes loss or gain of attribute
}).strip()

export type Cost = z.infer<typeof CostSchema>

export const BuffSchema = z.object({
  name: str.default(''),
  target: str.default(''), // what value does it target
  operation: str.default('+'), // +, *, set
  value: num.default(0),
}).strip()

export type Buff = z.infer<typeof BuffSchema>

export const SuppressionSchema = z.object({
  name: str.default(''),
  target: str.default(''), // rule/hook id whose effect is blocked entirely, e.g. 'affliction:hunger'
}).strip()

export type Suppression = z.infer<typeof SuppressionSchema>

export const FlashSchema = z.object({
  message: str.default(''),
  color: str.default(''),
}).strip()

export type Flash = z.infer<typeof FlashSchema>

export const TriggerSchema = z.enum(['instant', 'end_round', 'toggle'])
export type Trigger = z.infer<typeof TriggerSchema>

const EffectBase = {
  id: z.string().default(() => crypto.randomUUID()),
  name: str.default(''),
  trigger: TriggerSchema.default('instant'),
}

export const EffectSchema = z.discriminatedUnion('type', [
  z.object({ ...EffectBase, type: z.literal('cost'), effect: CostSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('buff'), effect: BuffSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('suppression'), effect: SuppressionSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('flash'), effect: FlashSchema }).strip(),
])

export type Effect = z.infer<typeof EffectSchema>

export const ActivationSchema = z.enum(['passive', 'active', 'toggle'])
export type Activation = z.infer<typeof ActivationSchema>

export const SurgeKindSchema = z.enum(['movement', 'combat', 'reaction', 'focus'])
export type SurgeKind = z.infer<typeof SurgeKindSchema>

export const AbilityTargetSchema = z.enum(['self', 'other'])
export type AbilityTarget = z.infer<typeof AbilityTargetSchema>

export const TalentSchema = z.object({
  level: num.default(1),
  property: z.enum(['CON', 'DEX', 'INT', 'SPI'])
})

export type Talent = z.infer<typeof TalentSchema>

export const AbilitySchema = z.object({
  name: str.default(''),
  activation: ActivationSchema.default('passive'), // passive: always contributes its effects · active: fires once, pays cost · toggle: fires on, contributes effects until toggled off
  cost: CostSchema,
  description: str.default(''),
  talent: z.array(TalentSchema),
  XPcost: num.default(6),
  target: AbilityTargetSchema.default('self'),
  effect: z.array(EffectSchema).default([]),
}).strip()

export type Ability = z.infer<typeof AbilitySchema>

const CampaignValues = {
  injuries: InjuriesSchema.partial().default({}).transform(v => InjuriesSchema.parse(v)),
  afflictions: z.array(AfflictionKeySchema).default([]),
  resources: ResourcesSchema.partial().default({}).transform(v => ResourcesSchema.parse(v)),
  usedSurge: SurgeKindSchema.nullable().default(null),
  activeEffects: z.array(EffectSchema).default([]),
}

export const CampaignValuesSchema = z.object({
  ...CampaignValues
})

export type CampaignValues = z.infer<typeof CampaignValuesSchema>

const CharacterValues = {
  id: z.string().default(() => crypto.randomUUID()),
  name: z.string().default(''),

  trainables: TrainablesSchema.partial().default({}).transform(v => TrainablesSchema.parse(v)),
  knowledges: KnowledgesSchema,
  size: z.number().default(3),
  TGH: z.number().default(0),
  senses: SensesSchema.partial().default({}).transform(v => SensesSchema.parse(v)),
  movement: MovementSchema.partial().default({}).transform(v => MovementSchema.parse(v)),
  
  hasGauntlets: z.number().default(0),
  hasHelm: z.number().default(0),
  
  armor: ArmorSchema.partial().default({}).transform(v => ArmorSchema.parse(v)),
  weapons: z.record(z.string(), WeaponSchema).default({}),
  containers: z.record(z.string(), ContainerSchema).default({}),

  abilities: z.array(str).default([]), // learned ability names, keyed into the abilities catalog

  notes: z.string().default(''),
}


export const BaseCharacterSchema = z.object({

  // Free-form category labels used only to group characters in the sidebar.
  // The first tag is the top-level group, the second the sub-group, and so on;
  // a character may carry any number of tags (including none -> "untagged").
  // This is the only categorization mechanism — there are no folders on disk.
  tags: z.array(z.string()).default([]),
  type: z.literal('base').default('base'),
  ...CharacterValues
}).strip()

export type BaseCharacter = z.infer<typeof BaseCharacterSchema>

export const CampaignCharacterSchema = z.object({
  ...CharacterValues,
  type: z.literal('campaign').default('campaign'),
  ...CampaignValues,
  fightName: z.string().optional(),
})

export type CampaignCharacter = z.infer<typeof CampaignCharacterSchema>

export type Character = BaseCharacter | CampaignCharacter

export type CharacterUpdater = (c: Character) => Character
export type CampaignCharacterUpdater = (c: Character) => CampaignCharacter

export interface Lens<T, V> {
  get: (subject: T) => V;
  set: (subject: T, value: V) => T;
}