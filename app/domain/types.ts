import { z } from 'zod'
import { ABILITY_SECTIONS, ITEM_TYPES } from './lists'
import { ACTION_COSTS, AFFLICTIONS, ActionKind } from './tables'
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

// gear.tex "Containers and Burden": an item's bulk is a size-like step —
// tiny 0, small 1, medium 2, large 3, then numeric — and scaling an item
// scales its bulk with it. One Item is a stack of `amount` identical units.
export const ItemTypeSchema = z.enum(ITEM_TYPES)
export type ItemType = z.infer<typeof ItemTypeSchema>

export const ItemSchema = z.object({
  id: str.default(() => crypto.randomUUID()),
  name: str.default(''), // with no refId, this + description is all that says what the item is
  description: str.default(''),
  // which catalog refId resolves in ('weapon' -> weapons.json, 'armor' -> armors.json); a type
  // the list no longer has (items saved as 'misc') lands in the general bucket
  type: ItemTypeSchema.catch('utility').default('utility'),
  amount: num.default(1),
  bulk: num.default(1), // 0 tiny · 1 small · 2 medium · 3 large · 4+ numeric
  refId: str.default(''), // key into the type's catalog; empty means this item is pure flavor, no linked object
}).strip()

export type Item = z.infer<typeof ItemSchema>

// gear.tex "Containers": belt, bandolier and backpack are worn one at a time;
// a saddle rides an animal; vehicles are drawn by one.
export const ContainerKindSchema = z.enum(['belt', 'bandolier', 'backpack', 'saddle', 'vehicle'])
export type ContainerKind = z.infer<typeof ContainerKindSchema>

// gear.tex "Containers": the Quick, Medium and Large columns.
export const SlotKindSchema = z.enum(['quick', 'medium', 'large'])
export type SlotKind = z.infer<typeof SlotKindSchema>

// Every group stores the bulk its slots take: the Quick column prints it
// ("4 medium", "8 small"), the other two are named after theirs, and scaling
// a container moves all of them together (gear.tex "Scaling a container").
const slotGroup = (slotBulk: number) => z.object({
  numSlots: num.default(0),
  slotBulk: num.default(slotBulk),
  items: z.array(ItemSchema).default([]),
}).strip()

export const SlotGroupSchema = slotGroup(1)

export type SlotGroup = z.infer<typeof SlotGroupSchema>

export const ContainerSchema = z.object({
  name: str.default(''),
  kind: ContainerKindSchema.default('backpack'),
  slots: z.object({
    quick: slotGroup(1).prefault({}),
    medium: slotGroup(2).prefault({}),
    large: slotGroup(3).prefault({}),
  }).prefault({}),
  // gear.tex "Containers": the Burden column, a size-like step compared to
  // the bearer's size; the penalty it becomes is derived, not stored.
  burden: num.default(3),
}).strip()

export type Container = z.infer<typeof ContainerSchema>

// A hand is a limb that fights and, if it can grip, wields. Its natural weapon
// is the weapons.json entry it attacks with while empty (gear.tex "Unarmed":
// the hands of a humanoid); a paw or a mouth still has one but takes no gear.
// `itemId` names the held stack in `held`, '' when free. Two hands naming the
// same stack are a two-handed grip (gear.tex "Small/One/Two hands").
export const HandSchema = z.object({
  name: str.default('hand'),
  naturalWeapon: str.default('Unarmed'),
  canHold: z.boolean().default(true),
  itemId: str.default(''),
}).strip()

export type Hand = z.infer<typeof HandSchema>

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
  ET: num.default(0), // exploration turns, spent by the exploration loop rather than here
}).strip()

export type Cost = z.infer<typeof CostSchema>

export const SurgeKindSchema = z.enum(['movement', 'combat', 'reaction', 'focus'])
export type SurgeKind = z.infer<typeof SurgeKindSchema>

// Everything a buff can land on, as `<group>:<key>`. The list is derived from
// the schemas so a key added to a group is a valid target the same day; the
// getter behind each group is what actually reads the bonus (skills add it as
// a term, movement and senses add it to the stored value, surges to AP, and
// `ap:`/`sta:` move the price of an action in ACTION_COSTS).
// A group is only listed once every one of its keys is read that way.
const prefixed = <P extends string, K extends string>(prefix: P, keys: readonly K[]) =>
  keys.map((k) => `${prefix}:${k}` as `${P}:${K}`)

export const BUFF_TARGETS = [
  ...prefixed('skill', Object.keys(SkillsSchema.shape) as (keyof Skills)[]),
  ...prefixed('movement', Object.keys(MovementSchema.shape) as (keyof Movement)[]),
  ...prefixed('sense', Object.keys(SensesSchema.shape) as (keyof Senses)[]),
  ...prefixed('surge', SurgeKindSchema.options),
  ...prefixed('ap', Object.keys(ACTION_COSTS) as ActionKind[]),
  ...prefixed('sta', Object.keys(ACTION_COSTS) as ActionKind[]),
]
export type BuffTarget = (typeof BUFF_TARGETS)[number]
export const BuffTargetSchema = z.enum(BUFF_TARGETS as [BuffTarget, ...BuffTarget[]])

export const BuffSchema = z.object({
  target: BuffTargetSchema,
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
export type EffectInput = z.input<typeof EffectSchema>

// Something switched on and held: a toggle ability today, a spell later.
// The character keeps only the reference; the effects are read off the
// owning catalog, so nothing copied into state can go stale.
export const ActiveEntrySchema = z.object({
  kind: z.enum(['ability', 'spell']),
  key: str,
}).strip()

export type ActiveEntry = z.infer<typeof ActiveEntrySchema>

export const ActivationSchema = z.enum(['passive', 'active', 'toggle'])
export type Activation = z.infer<typeof ActivationSchema>

export const AbilityTargetSchema = z.enum(['self', 'other'])
export type AbilityTarget = z.infer<typeof AbilityTargetSchema>

export const TalentSchema = z.object({
  level: num.default(1),
  property: z.enum(['CON', 'DEX', 'INT', 'SPI'])
})

export type Talent = z.infer<typeof TalentSchema>

// abilities.tex "Requirements": one item of what an ability asks for before
// it can be learned. `name` is a catalog key for an ability or spell, the
// book's word for a trainable, gear or condition; `level` is the minimum for
// a trainable and the threshold an attribute is compared against with `op`.
export const RequirementSchema = z.object({
  kind: z.enum(['ability', 'spell', 'gear', 'trainable', 'attribute', 'condition']),
  name: str.default(''),
  level: num.default(0),
  op: z.enum(['>', '<', '>=', '<=']).default('>='),
  not: z.boolean().default(false), // "not X": the item must be absent
}).strip()
export type Requirement = z.infer<typeof RequirementSchema>

// What one level of an ability states for itself: its price, what it asks
// for, what it does. Shared between the stored family shape and the
// expanded per-stage catalog entry.
const AbilityStageValues = {
  XPcost: num.default(0),
  karma: num.default(0), // negative: received when the ability is taken
  talent: z.array(TalentSchema).default([]), // creating.tex "Talent and Learning": the talent and training level the XP price assumes
  requirements: z.array(z.array(RequirementSchema)).default([]), // every outer item is needed, any inner alternative satisfies it
  description: str.default(''),
  effect: z.array(EffectSchema).default([]), // this stage's delta over the one before
}

export const AbilityStageSchema = z.object(AbilityStageValues).strip()
export type AbilityStage = z.infer<typeof AbilityStageSchema>

// abilities.tex "Acquiring abilities": an ability is stored as a family —
// what every level shares, then one stage per level (I, II, III). This is
// the shape app/assets/abilities.json holds and the editor writes.
export const AbilitySectionSchema = z.enum(ABILITY_SECTIONS)
export type AbilitySection = z.infer<typeof AbilitySectionSchema>

export const AbilityFamilySchema = z.object({
  family: str.default(''),
  section: AbilitySectionSchema.default(ABILITY_SECTIONS[0]),
  activation: ActivationSchema.default('passive'), // passive: always contributes its effects · active: fires once, pays cost · toggle: fires on, contributes effects until toggled off
  cost: CostSchema.default({ AP: 0, STA: 0, exhaustion: 0, IL: 0, ET: 0 }), // what a use of an active ability takes, on top of its instant cost effects
  target: AbilityTargetSchema.default('self'),
  stages: z.array(AbilityStageSchema).min(1),
}).strip()
export type AbilityFamily = z.infer<typeof AbilityFamilySchema>
export type AbilityFamilyInput = z.input<typeof AbilityFamilySchema>

// One stage of a family expanded for the domain: its own catalog entry,
// carrying what it adds on top of the stage before and requiring that stage.
export const AbilitySchema = z.object({
  name: str.default(''),
  family: str.default(''),
  stage: num.default(1),
  section: AbilitySectionSchema.default(ABILITY_SECTIONS[0]),
  activation: ActivationSchema.default('passive'),
  cost: CostSchema.default({ AP: 0, STA: 0, exhaustion: 0, IL: 0, ET: 0 }),
  target: AbilityTargetSchema.default('self'),
  requires: z.array(str).default([]), // catalog keys that must already be learned
  ...AbilityStageValues,
}).strip()
export type AbilityInput = z.input<typeof AbilitySchema>

export type Ability = z.infer<typeof AbilitySchema>

// combat.tex "Types of damage"; weapons still carry blunt and cut as columns
// of their own, this is the shared vocabulary everything else names a kind by.
export const DamageKindSchema = z.enum(['blunt', 'cut', 'burn', 'electric', 'radiant', 'corrosive'])
export type DamageKind = z.infer<typeof DamageKindSchema>

// spells.tex "Types of Spells": how a spell lives once cast. A sustained spell
// is a toggle whose cost comes due again at every round change; a curse holds
// until the target shrugs it off; a charge waits in an object.
export const SpellTypeSchema = z.enum(['instant', 'sustained', 'charged', 'curse'])
export type SpellType = z.infer<typeof SpellTypeSchema>

export const SpellDamageSchema = z.object({
  value: num.default(0),
  scaled: z.boolean().default(false), // xDM — scaled by the caster's size
  kind: DamageKindSchema.default('blunt'),
}).strip()
export type SpellDamage = z.infer<typeof SpellDamageSchema>

// `dl` is the side the caster sets (Charisma, Accuracy, a literal) and `roll`
// is what the defender tests against it. Both are kept as the book's words;
// resolving the DL side to a number for a given caster is a lens's job.
export const SpellTestSchema = z.object({
  dl: str.default(''),
  roll: str.default(''),
}).strip()
export type SpellTest = z.infer<typeof SpellTestSchema>

// What the defender's degree of success on the spell's test does to them.
export const SpellOutcomesSchema = z.object({
  miss: str.default(''),
  graze: str.default(''),
  hit: str.default(''),
  crit: str.default(''),
}).strip()
export type SpellOutcomes = z.infer<typeof SpellOutcomesSchema>

export const SpellKnowledgeRequirementSchema = z.object({
  name: str.default(''), // a knowledge name, lowercased like the knowledges record
  level: num.default(0),
}).strip()

export const SpellSchema = z.object({
  name: str.default(''),
  section: str.default(''), // the book's school, lowercased: the fallback casting knowledge
  type: SpellTypeSchema.default('instant'),
  cost: CostSchema.default({ AP: 0, STA: 0, exhaustion: 0, IL: 0, ET: 0 }), // paid before the roll
  costText: str.default(''), // the book's cost field verbatim, for materials and charges the domain does not track
  knowledge: z.array(SpellKnowledgeRequirementSchema).default([]),
  requirements: str.default(''), // gear, abilities, other spells — free text, not enforced
  DL: num.nullable().default(null), // casting DL; null while the book leaves it undecided
  castRange: str.default(''),
  castArea: str.default(''),
  effectRange: str.default(''),
  effectArea: str.default(''),
  duration: z.enum(['none', 'permanent', 'ET']).default('none'),
  durationETs: num.default(0),
  description: str.default(''),
  enhance: str.default(''), // what one "Enhance Spell" buys, in the book's words
  damage: SpellDamageSchema.nullable().default(null),
  test: SpellTestSchema.nullable().default(null),
  outcomes: SpellOutcomesSchema.nullable().default(null),
  effect: z.array(EffectSchema).default([]), // authored: a sustained spell's upkeep lives here
}).strip()
export type SpellInput = z.input<typeof SpellSchema>
export type Spell = z.infer<typeof SpellSchema>

// spells.tex "Learning spells": how a spell was learned decides the skill it
// is cast with, and `practice` is the per-spell skill trained with XP on top
// of that (the intuitive route has nothing else).
export const SpellMethodSchema = z.enum(['intuitive', 'wizard', 'cleric'])
export type SpellMethod = z.infer<typeof SpellMethodSchema>

export const LearnedSpellSchema = z.object({
  method: SpellMethodSchema.default('intuitive'),
  practice: num.default(0),
}).strip()
export type LearnedSpell = z.infer<typeof LearnedSpellSchema>

// The last action rolled and not yet resolved: what was attempted, what the
// die came to, and the SOPs it left to spend on improvements. One slot for
// spells and attacks alike — a new roll replaces it, a round change clears it.
export const PendingActionSchema = z.object({
  kind: z.enum(['spell', 'attack']),
  key: str.default(''),
  score: num.default(0), // roll + skill
  SOP: num.default(0), // what is still unspent
  spent: z.record(z.string(), num).default({}), // improvement -> times bought
}).strip()
export type PendingAction = z.infer<typeof PendingActionSchema>

const CampaignValues = {
  injuries: InjuriesSchema.partial().default({}).transform(v => InjuriesSchema.parse(v)),
  afflictions: z.array(AfflictionKeySchema).default([]),
  resources: ResourcesSchema.partial().default({}).transform(v => ResourcesSchema.parse(v)),
  usedSurge: SurgeKindSchema.nullable().default(null),
  active: z.array(ActiveEntrySchema).default([]),
  pendingAction: PendingActionSchema.nullable().default(null),
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
  hands: z.array(HandSchema).default(() => [HandSchema.parse({}), HandSchema.parse({})]),
  held: z.array(ItemSchema).default([]),
  containers: z.record(z.string(), ContainerSchema).default({}),

  abilities: z.array(str).default([]), // learned ability names, keyed into the abilities catalog
  spells: z.record(z.string(), LearnedSpellSchema).default({}), // keyed into the spell catalog

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