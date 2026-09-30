import { z } from 'zod'
import { ABILITY_SECTIONS, AMMO_KINDS, ARMOR_PROPERTIES, ATTACK_TYPES, HANDS, HEAVY_MAX_DEGREE, HIT_LOCATIONS, ITEM_TYPES, MATERIALS, MELEE_RANGES, MOVEMENT_KINDS, POSTURES, RANGES, SHAPES, TERRAIN_BRUSHES, WEAPON_PROPERTIES } from './lists'
import { ACTION_COSTS, AFFLICTIONS, ActionKind, SHOTS, ShotKind, WOUNDS, WoundKey } from './tables'

const num = z.number()
const str = z.string()

// What a piece of gear is made of; hardness follows from it (tables.ts
// MATERIAL_HARDNESS), so it is stored on every attack and armor rather than a
// "metallic" property.
export const MaterialSchema = z.enum(MATERIALS)
export type Material = z.infer<typeof MaterialSchema>

export const ArmorPropertySchema = z.enum(ARMOR_PROPERTIES)
export type ArmorProperty = z.infer<typeof ArmorPropertySchema>

export const ArmorSchema = z.object({
  name: z.string().default('Skin'),
  // the bare default is the creature's own hide
  material: MaterialSchema.default('flesh'),
  RES: z.number().default(0),
  // TGH: z.number().default(0),
  INS: z.number().default(0),
  // poise: z.number().default(0),
  protection: z.number().default(0),
  deflection: z.number().default(4), // gear.tex "Armors": the Skin row deflects at +4, so an unarmoured default is not 0
  burdenPenalty: z.number().default(0),
  // stored characters from before the vocabulary carried a free string here;
  // ingestion is lossy by design, so an unreadable list reads as none
  properties: z.array(ArmorPropertySchema).catch([]),
  notes: z.string().default(''),
  // the size the armor is made for, stamped when it is scaled from the
  // catalog; absent on the bare default, which is no armor at all
  scale: num.optional(),
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
export const SkillKeySchema = z.enum(Object.keys(SkillsSchema.shape) as [keyof Skills, ...(keyof Skills)[]])

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
  conviction1: trainable('proficiency', 0, 'Temperament'),
  conviction2: trainable('proficiency', 0, 'Worldview'),
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

export const AttackTypeSchema = z.enum(ATTACK_TYPES)
export type AttackType = z.infer<typeof AttackTypeSchema>

// combat.tex "Strike", "Throw", "Shoot": the three basic weapon attacks.
export type AttackKind = 'melee' | 'throw' | 'shoot'

export const HandedSchema = z.enum(HANDS)
export type Handed = z.infer<typeof HandedSchema>

export const RangeSchema = z.enum(RANGES)
export type Range = z.infer<typeof RangeSchema>
export type MeleeRange = (typeof MELEE_RANGES)[number]

export const WeaponPropertySchema = z.enum(WEAPON_PROPERTIES)

export const AmmoKindSchema = z.enum(AMMO_KINDS)
export type AmmoKind = z.infer<typeof AmmoKindSchema>
export type WeaponProperty = z.infer<typeof WeaponPropertySchema>

// gear.tex "Heavy I/II/III": "Having a higher degree of heavy allows using any
// lower degree. Having heavy I-III or similar means that heavy I is minimum,
// and normal attacks are not allowed." That is two bounds, not six spellings:
// `min` is the lowest heavy degree available and `max` the highest, with
// `min === 0` meaning the normal (non-heavy) attack is still allowed.
export const HeavyRangeSchema = z.object({
  min: num.int().min(0).max(HEAVY_MAX_DEGREE).default(0),
  max: num.int().min(1).max(HEAVY_MAX_DEGREE).default(1),
}).strip()
export type HeavyRange = z.infer<typeof HeavyRangeSchema>

// gear.tex "Explosion"; combat.tex "Explosions", "Sprays": the ground an
// exploding attack covers, in metres at the weapon's own scale — a disk
// about the point it lands on, or a cone from the attacker of a length and
// an opening angle (spells.tex "Flamethrower": "spray, 4m xRM, 60 degrees").
export const AreaSchema = z.discriminatedUnion('shape', [
  z.object({ shape: z.literal('explosion'), radius: num.default(1) }).strip(),
  z.object({ shape: z.literal('spray'), length: num.default(1), angle: num.default(60) }).strip(),
])
export type Area = z.infer<typeof AreaSchema>

// One row of a gear.tex weapon table. Whether it is melee or ranged is not
// stored, its range says (see getAttackType); nor is its block value, which
// gear.tex "DEF" derives from the wielder's STR and the row's hands.
export const WeaponAttackSchema = z.object({
  name: str.default(''),
  handed: HandedSchema.default('one'),
  range: RangeSchema.default('short'),
  // gear.tex "Weapons Properties": "All weapon attacks are made out of metal,
  // unless otherwise stated."
  material: MaterialSchema.default('metal'),

  RES: num.default(0),
  blunt: num.default(0),
  cut: num.default(0),
  AP: num.default(0),

  // gear.tex Ranged Weapons table prints AP as "4+4": the second term is the
  // reload, and only a row with the reload property has one.
  reload: num.optional(),
  // gear.tex "STR x": the strength requirement, absent when the row has none.
  STRreq: num.optional(),
  // gear.tex "Heavy I/II/III": the degrees offered, absent when the row has none.
  heavy: HeavyRangeSchema.optional(),
  // gear.tex "Quiver": what a shooting row is loaded with, absent on a row
  // that needs nothing loaded.
  ammo: AmmoKindSchema.optional(),
  // gear.tex "Explosion": what a mundane explosive does when it goes off,
  // in the shape a charged spell would give it; a row with the property and
  // nothing here explodes only once something is charged into it.
  payload: z.array(z.lazy(() => SpellEffectSchema)).default([]),

  properties: z.array(WeaponPropertySchema).default([]),
}).strip()

export type WeaponAttack = z.infer<typeof WeaponAttackSchema>

// gear.tex "Shields" table: what a shield has beyond its attack rows. Present
// only on a shield; its absence is what makes a weapon not one.
export const ShieldSchema = z.object({
  burdenPenalty: num.default(0),
  cover: num.default(0),
  insulation: num.default(0),
  // gear.tex "Shields": "Body shields ... can provide total cover."
  body: z.boolean().default(false),
}).strip()

export type Shield = z.infer<typeof ShieldSchema>

export const WeaponSchema = z.object({
  name: str.default(''),
  scale: num.default(3),
  shield: ShieldSchema.optional(),
  attacks: z.array(WeaponAttackSchema).default([]),
}).strip()

export type Weapon = z.infer<typeof WeaponSchema>

// gear.tex "Bows and crossbows can use different types of arrows": what the
// arrow or bolt adds to the row that shoots it.
export const AmmoSchema = z.object({
  name: str.default(''),
  kind: AmmoKindSchema.default('arrow'),
  properties: z.array(WeaponPropertySchema).default([]),
}).strip()

export type Ammo = z.infer<typeof AmmoSchema>

// gear.tex "Containers and Burden": an item's bulk is a size-like step —
// tiny 0, small 1, medium 2, large 3, then numeric — and scaling an item
// scales its bulk with it. One Item is a stack of `amount` identical units.
export const ItemTypeSchema = z.enum(ITEM_TYPES)
export type ItemType = z.infer<typeof ItemTypeSchema>

export const ChargeSchema = z.object({
  key: str.default(''),
  effects: z.array(z.lazy(() => SpellEffectSchema)).default([]),
}).strip()
export type Charge = z.infer<typeof ChargeSchema>

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
  // spells.tex "Charged": what is loaded into the item, waiting to go off —
  // which spell it is, and its effects as the caster produced them. Whoever
  // releases the charge is not who made it, so the numbers the caster's
  // size and skill decided are carried here rather than looked up again.
  charge: ChargeSchema.nullable().default(null),
  // combat.tex "Disarm": taken hold of by a grappler, "preventing them from
  // using it until they manage to escape" — still in hand, not usable.
  // Only a fight ever sets it, so a stored item carries none.
  seized: z.boolean().optional(),
  // gear.tex "Containers and Burden": a container is an item too, and what
  // it carries goes wherever it is put.
  container: z.lazy((): z.ZodType<Container> => ContainerSchema).optional(),
  // a body part cut off, kept whole so it can be put back (spells.tex
  // "Reattach Limb")
  part: z.lazy(() => BodyPartSchema).optional(),
}).strip()

export type Item = z.infer<typeof ItemSchema>

// gear.tex "Containers": belt, bandolier and backpack are worn one at a time;
// a saddle rides an animal; vehicles are drawn by one; a quiver is "slung on
// a belt".
export const ContainerKindSchema = z.enum(['belt', 'bandolier', 'backpack', 'quiver', 'saddle', 'vehicle'])
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

// Written out rather than inferred: an item may carry a container, so the
// two schemas refer to each other and inference cannot close the loop.
export interface SlotGroup {
  numSlots: number
  slotBulk: number
  items: Item[]
}

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
  // gear.tex "Containers": the Bulk column — the container as an item.
  bulk: num.default(2),
}).strip()

export interface Container {
  name: string
  kind: ContainerKind
  slots: Record<SlotKind, SlotGroup>
  burden: number
  bulk: number
}

export const HitLocationSchema = z.enum(HIT_LOCATIONS)
export type HitLocation = z.infer<typeof HitLocationSchema>

// combat.tex "Localized damage": "Each type of creature may have places that
// can specifically be aimed at" — the body is those places, each a part with
// a stable id that wounds and grips point at. `location` is the kind of place
// it is, the row of the location and wound tables that applies to it. A part
// that grips holds the stack `itemId` names in `held`, '' when free; two
// parts naming the same stack are a two-handed grip (gear.tex "Small/One/Two
// hands"). Its natural weapon is the weapons.json entry it attacks with while
// empty (gear.tex "Unarmed": the hands of a humanoid); a paw or a jaw has one
// but takes no gear. A `lost` part was cut off: the slot keeps its shape for
// whatever puts it back.
export const BodyPartSchema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  name: str.default(''),
  location: HitLocationSchema.default('chest'),
  grip: z.boolean().default(false),
  itemId: str.default(''),
  naturalWeapon: str.default(''),
  lost: z.boolean().default(false),
}).strip()

export type BodyPart = z.infer<typeof BodyPartSchema>

const HUMANOID_BODY: z.input<typeof BodyPartSchema>[] = [
  { id: 'chest', name: 'chest', location: 'chest' },
  { id: 'head', name: 'head', location: 'head' },
  { id: 'handL', name: 'left hand', location: 'hand', grip: true, naturalWeapon: 'Unarmed' },
  { id: 'handR', name: 'right hand', location: 'hand', grip: true, naturalWeapon: 'Unarmed' },
  { id: 'legL', name: 'left leg', location: 'leg' },
  { id: 'legR', name: 'right leg', location: 'leg' },
]

// How many legs short — lost or wounded — leave the creature lame, and how
// many leave it unable to stand; authored per creature, as a body is.
export const StanceSchema = z.object({
  lameAt: num.default(1),
  proneAt: num.default(2),
}).strip()

export type Stance = z.infer<typeof StanceSchema>

export const WoundKeySchema = z.enum(Object.keys(WOUNDS) as [WoundKey, ...WoundKey[]])

// combat.tex "Wounds": a wound carried until it is healed, on the part it
// took. `IL` is the healing it still needs — its "IL wound", "tracked
// separately from the main IL" — which starts at the table's value unless
// what caused it says otherwise; healed to none, it is gone.
export const WoundSchema = z.object({
  key: WoundKeySchema,
  part: str,
  IL: num.default(0),
}).strip()

export type Wound = z.infer<typeof WoundSchema>

export const InjuriesSchema = z.object({
  injuryLevel: z.number().default(0),
  wounds: z.array(WoundSchema).default([]),
  bleed: z.number().default(0),
  // combat.tex "Burning and radiant damage": the burning counter
  burning: z.number().default(0),
  // combat.tex "Fire": the worst fire surface touched during the character's
  // own turn, dealt as burning damage when the turn ends
  scorch: z.number().default(0),
  potion: z.number().default(0),
  injuryThreshold: z.number().default(10),
  unconsciousThreshold: z.number().default(40),
  deathThreshold: z.number().default(50),
}).strip()

export type Injuries = z.infer<typeof InjuriesSchema>

export const ResourcesSchema = z.object({
  AP: num.default(0),
  // combat.tex "Action surge": what is left of a movement or combat surge,
  // spent before AP and only on what that surge allows
  surgeAP: num.default(0),
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
// a term, movement and senses add it to the stored value, surges to AP,
// `ap:`/`sta:` move the price of an action in ACTION_COSTS, `reach:` the
// metres a way of shooting covers and `hit:` its test).
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
  ...prefixed('reach', Object.keys(SHOTS) as ShotKind[]),
  ...prefixed('hit', Object.keys(SHOTS) as ShotKind[]),
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

export const TriggerSchema = z.enum(['instant', 'end_round', 'toggle'])
export type Trigger = z.infer<typeof TriggerSchema>

// play.tex "Degrees of success". An attack never lands the critical: past a
// hit it is HOP (play.tex "Hit Overflow Point"); a skill test does, and so
// does the centre of an explosion (combat.tex "Explosions").
export const DEGREES = ['miss', 'graze', 'hit', 'critical'] as const
export const DegreeSchema = z.enum(DEGREES)
export type Degree = z.infer<typeof DegreeSchema>

// combat.tex "Interruption", "Stun": what a blow does to the action its
// target was in the middle of; a stun is an interruption that also costs AP.
export const InterruptionSchema = z.enum(['none', 'interrupted', 'stunned'])
export type Interruption = z.infer<typeof InterruptionSchema>

// combat.tex "Defend", "Reflex": how the target met the attack, none being
// the SD — the four melee defenses against a strike, evasion and guard
// against a shot, the reflex test against an explosion.
export const DefenseKindSchema = z.enum(['none', 'evade', 'evasiveJump', 'block', 'intercept', 'evasion', 'guard', 'avoidExplosion'])
export type DefenseKind = z.infer<typeof DefenseKindSchema>

// combat.tex "Types of damage": the six kinds, each defended by its own
// armor value (blunt by protection, cutting by RES, the rest by INS).
export const DamageKindSchema = z.enum(['blunt', 'cut', 'burn', 'electric', 'radiant', 'corrosive'])
export type DamageKind = z.infer<typeof DamageKindSchema>

// Damage as it reaches a character, final: every number resolved by whoever
// produced it, so the target turns it into an injury with nothing but its
// own armor and toughness. combat.tex "Physical attacks": a weapon carries
// "blunt and cutting damage components"; a spell or a fire carries one kind.
// The rest is what an attack brings with it — what it was met with (the
// defense is here because what a block or an intercept does to the damage is
// the producer's number to carry), where it lands, what the overflow bought.
export const DamageComponentSchema = z.object({
  kind: DamageKindSchema.default('blunt'),
  value: num.default(0),
}).strip()
export type DamageComponent = z.infer<typeof DamageComponentSchema>

export const DamageSchema = z.object({
  damage: z.array(DamageComponentSchema).default([]),
  hardness: num.default(0),
  force: num.default(0),
  properties: z.array(WeaponPropertySchema).default([]),
  location: HitLocationSchema.default('chest'),
  // the target's part the blow was aimed at, by id; null leaves it to land
  // on whichever part is there (combat.tex "Localized damage")
  part: str.nullable().default(null),
  defense: DefenseKindSchema.default('none'),
  // the AP the defender spent on the reaction
  defenseAP: num.default(0),
  // what the defender blocked or intercepted with, by the target's own
  // wielded key: names the hand a wound lands on
  defenseWeaponKey: str.default(''),
  block: num.default(0), // gear.tex "DEF": what the blocking object absorbs
  shield: z.boolean().default(false),
  bypass: z.boolean().default(false),
  bust: z.boolean().default(false),
  smash: z.boolean().default(false),
}).strip()
export type Damage = z.infer<typeof DamageSchema>

// What one entity does to a character — a spell, an ability, an attack, a
// fire, a charge in an item all speak this. The character processes an
// effect when its trigger fires and applies it; nothing here says who made
// it or how it was aimed, that is the producer's business.
const EffectBase = {
  name: str.default(''),
  trigger: TriggerSchema.default('instant'),
}

// combat.tex "Afflictions": a condition put on the character — poison, a
// blindness, a corrosion. It joins the afflictions the character carries, the
// worst of its group winning, as the affliction rules say.
export const AfflictionEffectSchema = z.object({
  key: AfflictionKeySchema,
}).strip()

// combat.tex "Visibility": what the ground does to whoever stands in it.
export const VisibilitySchema = z.enum(['good', 'bad', 'zero'])
export type Visibility = z.infer<typeof VisibilitySchema>

// combat.tex "Gas", "Fire": what an area does to the ground it covers, by
// zone — black smoke "affects visibility and also cause suffocation"; a
// patch that ignites leaves a fire surface burning with the damage the
// area's own burn deals in that zone. A patch says what it sets; null
// leaves the cell's visibility as it was.
export const TerrainPatchSchema = z.object({
  visibility: VisibilitySchema.nullable().default(null),
  suffocating: z.boolean().default(false),
  ignite: z.boolean().default(false),
}).strip()

const NO_PATCH = { visibility: null, suffocating: false, ignite: false }
export const TerrainEffectSchema = z.object({
  critical: TerrainPatchSchema.default(NO_PATCH),
  hit: TerrainPatchSchema.default(NO_PATCH),
  graze: TerrainPatchSchema.default(NO_PATCH),
}).strip()

export const EffectSchema = z.discriminatedUnion('type', [
  z.object({ ...EffectBase, type: z.literal('cost'), effect: CostSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('buff'), effect: BuffSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('suppression'), effect: SuppressionSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('damage'), effect: DamageSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('affliction'), effect: AfflictionEffectSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('terrain'), effect: TerrainEffectSchema }).strip(),
])

export type Effect = z.infer<typeof EffectSchema>
export type EffectInput = z.input<typeof EffectSchema>

// What an effect has to have come to before a follow-up lands: the injury
// tier its parent caused (combat.tex "Cutting damage": poison "when damage
// is at least T0").
export const ConditionSchema = z.object({
  minTier: num.nullable().default(null),
}).strip()
export type Condition = z.infer<typeof ConditionSchema>

// The test a delivered effect leaves to its target (play.tex "Skill test"):
// the skill they roll and the DL the producer set. Their degree is turned
// against the effect — a miss lets it land in full, a graze at half, a hit
// or better not at all — the way combat.tex "Evasion" reads a reflex test
// against a shot. A delivery with no test lands at the degree it came with.
export const DeliveryTestSchema = z.object({
  roll: SkillKeySchema,
  DL: num.default(0),
}).strip()
export type DeliveryTest = z.infer<typeof DeliveryTestSchema>

// An effect on its way to a character. `degree` is how hard it lands — set
// by the producer when its own test or the zone decided it, left null for
// the target to decide by the `test` of their own. `when` gates it on what
// its parent came to, and `then` is what its own landing produces next: an
// attack is a damage delivery, a poisoned blade a damage delivery whose
// `then` carries the poison, gated on the cut reaching T0.
// `locks` names the catalog entry a lasting effect comes from (spells.tex
// "Curse"): once it lands it is not applied but carried, read off the
// catalog for as long as it is, until the target beats it.
export type Delivery = {
  effect: Effect
  degree: Degree | null
  test: DeliveryTest | null
  when: Condition | null
  then: Delivery[]
  locks: string | null
}
export const DeliverySchema: z.ZodType<Delivery, Delivery> = z.lazy(() => z.object({
  effect: EffectSchema,
  degree: DegreeSchema.nullable().default(null),
  test: DeliveryTestSchema.nullable().default(null),
  when: ConditionSchema.nullable().default(null),
  then: z.array(DeliverySchema).default([]),
  locks: str.nullable().default(null),
}).strip()) as unknown as z.ZodType<Delivery, Delivery>

// Something switched on and held: a toggle ability, a held spell, or a
// curse carried until it is beaten. The character keeps only the reference;
// the effects are read off the owning catalog, so nothing copied into state
// can go stale. A curse keeps the DL the test to beat it is rolled against
// (spells.tex "Curse": "until the target shrugs it off"); a held spell that
// links keeps who it is linked to, by character id.
export const ActiveEntrySchema = z.object({
  kind: z.enum(['ability', 'spell', 'curse']),
  key: str,
  DL: num.optional(),
  targets: z.array(str).optional(),
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
// `sustaining` names a spell the caster must be holding to cast this one.
export const RequirementSchema = z.object({
  kind: z.enum(['ability', 'spell', 'gear', 'trainable', 'attribute', 'condition', 'sustaining']),
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

// spells.tex "Types of Spells": how a spell lives once cast. A sustained spell
// is a toggle whose cost comes due again at every round change; a curse holds
// until the target shrugs it off; a charge waits in an object.
export const SpellTypeSchema = z.enum(['instant', 'sustained', 'charged', 'curse'])
export type SpellType = z.infer<typeof SpellTypeSchema>

// `dl` is the side the caster sets (Charisma, Accuracy, a literal) and `roll`
// is what the defender tests against it. Both are kept as the book's words;
// resolving the DL side to a number for a given caster is a lens's job.
export const SpellTestSchema = z.object({
  dl: str.default(''),
  roll: str.default(''),
}).strip()
export type SpellTest = z.infer<typeof SpellTestSchema>

// spells.tex "Amplify Spell": which of an effect's numbers the book marks
// to scale with the spell's size — "The damage is increased by DM, the
// effect reach and area by RM". The multiplier each reads is the book's;
// the mark is the spell's.
export const SpellScalesSchema = z.object({
  damage: z.boolean().default(false),
  area: z.boolean().default(false),
  reach: z.boolean().default(false),
}).strip()
export type SpellScales = z.infer<typeof SpellScalesSchema>

const NO_SCALES = { damage: false, area: false, reach: false }

// What a spell does, one effect at a time, each with its own reach: who it
// lands on (the caster, the one target, everyone in an area), how far the
// caster can put it (metres; null is touch or self), the area it
// covers, which of its numbers scale with the spell's size, the test it
// leaves the target (the DL side in the book's words, resolved for the
// caster at production), and how long it stays — gone once applied, held
// by the caster with its upkeep (spells.tex "Sustained"), or locked on the
// target until something resolves it (spells.tex "Curse").
const SpellEffectEnvelope = {
  target: z.enum(['self', 'target', 'area']).default('target'),
  range: num.nullable().default(null),
  area: AreaSchema.nullable().default(null),
  scales: SpellScalesSchema.default(NO_SCALES),
  resist: z.object({ dl: str.default(''), roll: SkillKeySchema }).strip().nullable().default(null),
  duration: z.enum(['instant', 'held', 'locked']).default('instant'),
}
export const SpellEffectSchema = z.discriminatedUnion('type', [
  z.object({ ...EffectBase, ...SpellEffectEnvelope, type: z.literal('cost'), effect: CostSchema }).strip(),
  z.object({ ...EffectBase, ...SpellEffectEnvelope, type: z.literal('buff'), effect: BuffSchema }).strip(),
  z.object({ ...EffectBase, ...SpellEffectEnvelope, type: z.literal('suppression'), effect: SuppressionSchema }).strip(),
  // authored damage is what the spell throws — its kinds and what it can
  // cut — the rest of a delivery's damage is the producer's to write, except
  // `force` on an area effect: combat.tex "Intercept" compares force to
  // whoever met the blow, and an explosion's blast is its own, not whoever
  // set it off
  z.object({ ...EffectBase, ...SpellEffectEnvelope, type: z.literal('damage'), effect: DamageSchema.pick({ damage: true, hardness: true, properties: true, force: true }) }).strip(),
  z.object({ ...EffectBase, ...SpellEffectEnvelope, type: z.literal('affliction'), effect: AfflictionEffectSchema }).strip(),
  z.object({ ...EffectBase, ...SpellEffectEnvelope, type: z.literal('terrain'), effect: TerrainEffectSchema }).strip(),
])
export type SpellEffect = z.infer<typeof SpellEffectSchema>

// An effect one degree of the spell's test lets through. The cast decided
// who it reaches and the test whether it lands, so it carries neither —
// only whether its damage scales with the spell's size.
const OutcomeEffectEnvelope = {
  scales: SpellScalesSchema.pick({ damage: true }).default({ damage: false }),
}
export const OutcomeEffectSchema = z.discriminatedUnion('type', [
  z.object({ ...EffectBase, ...OutcomeEffectEnvelope, type: z.literal('cost'), effect: CostSchema }).strip(),
  z.object({ ...EffectBase, ...OutcomeEffectEnvelope, type: z.literal('buff'), effect: BuffSchema }).strip(),
  z.object({ ...EffectBase, ...OutcomeEffectEnvelope, type: z.literal('suppression'), effect: SuppressionSchema }).strip(),
  z.object({ ...EffectBase, ...OutcomeEffectEnvelope, type: z.literal('damage'), effect: DamageSchema.pick({ damage: true, hardness: true, properties: true, force: true }) }).strip(),
  z.object({ ...EffectBase, ...OutcomeEffectEnvelope, type: z.literal('affliction'), effect: AfflictionEffectSchema }).strip(),
  z.object({ ...EffectBase, ...OutcomeEffectEnvelope, type: z.literal('terrain'), effect: TerrainEffectSchema }).strip(),
])
export type OutcomeEffect = z.infer<typeof OutcomeEffectSchema>

// What one degree of the target's own result on the spell's test does to
// them: the book's words, and the effects encoded from them so far.
export const SpellOutcomeSchema = z.object({
  text: str.default(''),
  effects: z.array(OutcomeEffectSchema).default([]),
}).strip()
export type SpellOutcome = z.infer<typeof SpellOutcomeSchema>

const NO_OUTCOME = { text: '', effects: [] }
export const SpellOutcomesSchema = z.object({
  miss: SpellOutcomeSchema.default(NO_OUTCOME),
  graze: SpellOutcomeSchema.default(NO_OUTCOME),
  hit: SpellOutcomeSchema.default(NO_OUTCOME),
  critical: SpellOutcomeSchema.default(NO_OUTCOME),
}).strip() satisfies z.ZodType<Record<Degree, SpellOutcome>>
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
  // spells.tex "Sustained Spells": what holding it costs at every round
  // change; null is the casting cost again
  upkeep: CostSchema.nullable().default(null),
  costText: str.default(''), // the book's cost field verbatim, for materials and charges the domain does not track
  knowledge: z.array(SpellKnowledgeRequirementSchema).default([]),
  // spells.tex "Requirements": what the spell cannot be had or cast without
  // — gear the caster must have on them, the knowledge and the spells it is
  // learned from. Every outer item is needed, any inner alternative
  // satisfies it, as an ability's are.
  requirements: z.array(z.array(RequirementSchema)).default([]),
  DL: num.nullable().default(null), // casting DL; null while the book leaves it undecided
  // a held spell that links its caster to its targets: what each link adds
  // to the DL of every spell the caster casts while holding it; null for a
  // spell that links nobody
  linkDL: num.nullable().default(null),
  castRange: str.default(''),
  castArea: str.default(''),
  // spells.tex "Detonate Explosive": the spell sets off a charge already in
  // an object, within this many metres of the caster; null for one that
  // does not
  detonate: z.object({ range: num.default(0) }).strip().nullable().default(null),
  duration: z.enum(['none', 'permanent', 'ET']).default('none'),
  durationETs: num.default(0),
  description: str.default(''),
  enhance: str.default(''), // what one "Enhance Spell" buys, in the book's words
  // the spell's target test as the book words it, whose degree picks the
  // outcome; an effect the target dodges carries its own `resist` instead
  test: SpellTestSchema.nullable().default(null),
  outcomes: SpellOutcomesSchema.nullable().default(null),
  effects: z.array(SpellEffectSchema).default([]),
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
// die came to, and the HOPs it left to spend on improvements. One slot for
// spells and attacks alike — a new roll replaces it, a round change clears it.

const CampaignValues = {
  injuries: InjuriesSchema.partial().default({}).transform(v => InjuriesSchema.parse(v)),
  afflictions: z.array(AfflictionKeySchema).default([]),
  resources: ResourcesSchema.partial().default({}).transform(v => ResourcesSchema.parse(v)),
  usedSurge: SurgeKindSchema.nullable().default(null),
  // combat.tex "Action surge": "Running costs no STA during a movement
  // surge" — for the rest of the turn it was made in
  runsFree: z.boolean().default(false),
  active: z.array(ActiveEntrySchema).default([]),
  // effects delivered and not yet applied: each waits on the target's own
  // test for its degree
  pending: z.array(DeliverySchema).default([]),
}

export const CampaignValuesSchema = z.object({
  ...CampaignValues
})

export type CampaignValues = z.infer<typeof CampaignValuesSchema>

export const ShapeSchema = z.enum(SHAPES)
export type Shape = z.infer<typeof ShapeSchema>

export const MovementKindSchema = z.enum(MOVEMENT_KINDS)
export type MovementKind = z.infer<typeof MovementKindSchema>

export const PostureSchema = z.enum(POSTURES)
export type Posture = z.infer<typeof PostureSchema>

// What a move is made at: a way of crossing cells or a change of posture.
export const MoveKindSchema = z.enum([...MOVEMENT_KINDS, ...POSTURES])
export type MoveKind = z.infer<typeof MoveKindSchema>

export const TerrainBrushSchema = z.enum(TERRAIN_BRUSHES)
export type TerrainBrush = z.infer<typeof TerrainBrushSchema>

const CharacterValues = {
  id: z.string().default(() => crypto.randomUUID()),
  name: z.string().default(''),

  trainables: TrainablesSchema.partial().default({}).transform(v => TrainablesSchema.parse(v)),
  knowledges: KnowledgesSchema,
  size: z.number().default(3),
  // creating.tex "Size and Space Occupation": how the cells the size grants
  // are laid out on the grid
  shape: ShapeSchema.default('blob'),
  TGH: z.number().default(0),
  senses: SensesSchema.partial().default({}).transform(v => SensesSchema.parse(v)),
  movement: MovementSchema.partial().default({}).transform(v => MovementSchema.parse(v)),
  
  hasGauntlets: z.number().default(0),
  hasHelm: z.number().default(0),
  // gear.tex "Closed helmet": the visor raised; the helmet's penalties and its
  // guard against a bypass at the head hold only while it is down
  visorOpen: z.boolean().default(false),
  
  // what the creature is under anything it wears — skin, fur, hide; the rows
  // of the gear.tex "Armors" table with no bulk, which are not items
  armor: ArmorSchema.partial().default({}).transform(v => ArmorSchema.parse(v)),
  // the armor item being worn over it, if any (gear.tex "Donning and Doffing armor")
  worn: ItemSchema.nullable().default(null),
  body: z.array(BodyPartSchema).default(() => HUMANOID_BODY.map((part) => BodyPartSchema.parse(part))),
  stance: StanceSchema.partial().default({}).transform(v => StanceSchema.parse(v)),
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