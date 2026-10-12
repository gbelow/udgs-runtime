import { z } from 'zod'
import { ABILITY_SECTIONS, AMMO_KINDS, ARMOR_PROPERTIES, ATTACK_TYPES, DEFENSES, EDGES, FUELS, GRAPPLE_MANEUVERS, HANDS, HEAVY_MAX_DEGREE, HIT_LOCATIONS, HOP_PURCHASES, ITEM_TYPES, knowledges_list, LIMIT_STRESS_ACTIONS, MATERIALS, MELEE_RANGES, MOVEMENT_KINDS, PART_FLAGS, POSTURES, RANGES, TERRAIN_BRUSHES, WEAPON_PROPERTIES, WOUND_EFFECTS } from './lists'
import { ACTION_COSTS, AFFLICTIONS, ActionKind, MOVEMENT_BLOCKS, PART_PRESETS, SHOTS, ShotKind } from './tables'

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

export const TrainableTypeSchema = z.enum(['skill', 'attribute', 'talent', 'proficiency', 'knowledge', 'ability'])
export type TrainableType = z.infer<typeof TrainableTypeSchema>

export const TrainableSchema = z.object({
  value: z.number().default(0),
  name: z.string().default(''),
  XP: z.number().default(0),
  type: TrainableTypeSchema.default('skill'),
}).strip()
export type Trainable = z.infer<typeof TrainableSchema>

// small helper so the group schemas aren't a wall of repeated defaults
const trainable = (type: TrainableType, value = 0, name: string) =>
  TrainableSchema.default({ value, name, XP: 0, type })

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

// creating.tex "Areas of Knowledge": the formal knowledges, trained as skills
// are. Each is named by its key, the name requirements and spells use.
type KnowledgeKey = (typeof knowledges_list)[number]
export const KnowledgesSchema = z.object(
  Object.fromEntries(knowledges_list.map((name) => [name, trainable('knowledge', 0, name)])) as Record<KnowledgeKey, ReturnType<typeof trainable>>,
).strip()
export type Knowledges = z.infer<typeof KnowledgesSchema>

// story.tex "Specific Knowledge": open-ended (a town, a language, how to ride
// a specific animal), so a plain record of levels by name. It is learned
// through learning tests, never with XP, and no name is a formal knowledge's.
export const SpecificKnowledgesSchema = z.record(z.string(), z.number()).default({})
export type SpecificKnowledges = z.infer<typeof SpecificKnowledgesSchema>

// ── merged whole ────────────────────────────────────────
export const TrainablesSchema = SkillsSchema
  .merge(AttributesSchema)
  .merge(TalentsSchema)
  .merge(ProficienciesSchema)
  .merge(KnowledgesSchema)

export type Trainables = z.infer<typeof TrainablesSchema>

export const CharacteristicsSchema = AttributesSchema
  .merge(TalentsSchema)
  .merge(ProficienciesSchema)

export type Characteristics = z.infer<typeof CharacteristicsSchema>

// combat.tex "Movement Costs and Speeds": what one block of a movement costs
// the character and how far it goes. A number is the stored form of a
// character from before blocks were stored whole: the speed itself for a
// walk, what a run or jump had over its base, what standing up had over its
// AP; a speed below a metre is the metre it has been since.
const MovementBlockSchema = z.object({ AP: num, STA: num, distance: num }).partial()
function movementBlock(key: keyof typeof MOVEMENT_BLOCKS) {
  const base = MOVEMENT_BLOCKS[key]
  const legacy = (n: number) => {
    if (key === 'stand') return { AP: base.AP + n }
    if (key === 'run' || key === 'jump') return { distance: base.distance + n }
    return { distance: key === 'basic' || key === 'fast swim' ? n : Math.max(base.distance, n) }
  }
  return z.preprocess(
    (v) => (typeof v === 'number' ? (Number.isFinite(v) ? legacy(v) : {}) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === 'number' && Number.isFinite(n))) : {}),
    MovementBlockSchema.transform((b) => ({ ...base, ...b })),
  ).default(base)
}

export const MovementSchema = z.object({
  basic: movementBlock('basic'),
  careful: movementBlock('careful'),
  crawl: movementBlock('crawl'),
  climb: movementBlock('climb'),
  run: movementBlock('run'),
  jump: movementBlock('jump'),
  swim: movementBlock('swim'),
  'fast swim': movementBlock('fast swim'),
  stand: movementBlock('stand'),
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
  // `grazes`: whether the outermost ring is the graze zone (combat.tex "Explosions"), or a hit like the rings between
  z.object({ shape: z.literal('explosion'), radius: num.default(1), grazes: z.boolean().optional() }).strip(),
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
export const EdgeSchema = z.enum(EDGES)
export const FuelSchema = z.enum(FUELS)
export type Fuel = z.infer<typeof FuelSchema>
export type Edge = z.infer<typeof EdgeSchema>

export const ItemTypeSchema = z.enum(ITEM_TYPES)
export type ItemType = z.infer<typeof ItemTypeSchema>

// spells.tex "Charged": "The charge can be released when a trigger is
// activated if there is one" — landing where it was thrown, touching fire,
// the Detonate Explosive spell, or the blow of the weapon it is in landing
// ("Taser": "discharges on the first object it comes into contact with").
export const ChargeTriggerSchema = z.enum(['impact', 'fire', 'detonate', 'contact'])
export type ChargeTrigger = z.infer<typeof ChargeTriggerSchema>

export const ChargeSchema = z.object({
  key: str.default(''),
  effects: z.array(z.lazy(() => SpellEffectSchema)).default([]),
}).strip()
export type Charge = z.infer<typeof ChargeSchema>

// gear.tex "Electrite": "Deals 10 base electric damage. 20 charges." — what
// a stone or device puts out, which the spells drawing on it multiply, and
// the uses it has left (ammo, not a spells.tex "Charged" charge).
export const SourceSchema = z.object({
  damage: z.array(z.lazy(() => DamageComponentSchema)).default([]),
  ammo: num.default(0),
}).strip()
export type Source = z.infer<typeof SourceSchema>

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
  source: SourceSchema.nullable().default(null),
  // gear.tex "Containers and Burden": a container is an item too, and what
  // it carries goes wherever it is put.
  container: z.lazy((): z.ZodType<Container> => ContainerSchema).optional(),
  // gear.tex "Weapon Breakage", "Armor Breakage": a broken weapon can no
  // longer be used, and broken armor is pitted
  broken: z.boolean().default(false),
  // gear.tex "Gear condition": Sharp and Dull, a blade's edge beyond the usual
  edge: EdgeSchema.nullable().default(null),
  // gear.tex "Special Items": a flask that breaks where it lands and coats the
  // space in this fuel
  fuel: FuelSchema.nullable().default(null),
  // combat.tex "Camouflage": what the item adds to its bearer's stealth
  // against vision, carried, as the bad visibility it makes of them; null for
  // an item that is no camouflage (gear.tex "Camouflage for X": "In combat,
  // gives -3 penalty to stealth, but allows stealth against vision")
  camouflage: num.nullable().default(null),
  // gear.tex "Muffled Boots": "Denies noise penalties from terrain"
  muffles: z.boolean().default(false),
  // gear.tex "Reload": the arrow or bolt a weapon that must be reloaded
  // holds, put in by a reload and gone with the next shot; it stays in the
  // weapon between fights (the table's ruling). Null while it is empty.
  loaded: z.object({ refId: str.default(''), name: str.default('') }).strip().nullable().default(null),
  // gear.tex "Torch": "Gives 5m light radius when lit" — the radius in
  // metres, lit while held or lying on the floor (the table's ruling); null
  // for an item that gives no light
  light: num.nullable().default(null),
  // gear.tex "Potions and Medicine": what a dose of it does to whoever takes
  // it; null for what is not taken
  consume: z.lazy(() => ConsumeSchema).nullable().default(null),
  // survival.tex "Hunger": "Each portion eaten recovers a number of hunger
  // points defined in the portion itself" — one unit of the stack is a
  // portion; null for what is not food
  food: num.nullable().default(null),
  // a body part cut off, kept whole so it can be put back (spells.tex
  // "Reattach Limb"), and the id of the character it was cut from
  part: z.lazy(() => BodyPartSchema).optional(),
  severedFrom: str.optional(),
}).strip()

export type Item = z.infer<typeof ItemSchema>

// gear.tex "Potions and Medicine": "Potions add an effect to the character
// for a certain duration" — what one dose puts on whoever takes it: a heal
// lands at once, a buff or a suppression lasts `ETs` exploration turns. The
// doses left in this unit ("10 charges").
export const ConsumeSchema = z.object({
  effects: z.array(z.lazy(() => EffectSchema)).default([]),
  ETs: num.default(0),
  doses: num.default(1),
}).strip()
export type Consume = z.infer<typeof ConsumeSchema>

// gear.tex's Price columns: what a catalog entry costs made for size 3, in
// coppers (story.tex "Wealth and Money"); null where the book prints none.
// Kept on the catalog entry only — an item reads its price off the entry it
// was stamped from.
const PriceSchema = num.int().nonnegative().nullable().default(null)

// An entry of the items catalog. `currency` marks a stable currency: anyone
// takes it at its price, and it counts as the money a character has.
export const ItemEntrySchema = ItemSchema.extend({
  price: PriceSchema,
  currency: z.boolean().default(false),
})

// gear.tex "Containers": belt, bandolier and backpack are worn one at a time;
// a saddle rides an animal; vehicles are drawn by one; a quiver is "slung on
// a belt"; a coin pouch goes in a slot like any small item.
export const ContainerKindSchema = z.enum(['belt', 'bandolier', 'backpack', 'quiver', 'pouch', 'saddle', 'vehicle'])
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

export const ContainerEntrySchema = ContainerSchema.extend({ price: PriceSchema })

export interface Container {
  name: string
  kind: ContainerKind
  slots: Record<SlotKind, SlotGroup>
  burden: number
  bulk: number
}

// A hex cell in axial coordinates; one cell is one metre (combat.tex
// "Movement Costs and Speeds" prices basic movement at 1 AP per metre and
// "Movement" moves in whole spaces). The geometry that reads these is in
// `scene/rules/board/geometry.ts`.
export const CoordSchema = z.object({ q: num.default(0), r: num.default(0) }).strip()
export type Coord = z.infer<typeof CoordSchema>

export const HitLocationSchema = z.enum(HIT_LOCATIONS)
export type HitLocation = z.infer<typeof HitLocationSchema>

export const PartFlagSchema = z.enum(PART_FLAGS)
export type PartFlag = z.infer<typeof PartFlagSchema>

export const WoundEffectSchema = z.enum(WOUND_EFFECTS)
export type WoundEffect = z.infer<typeof WoundEffectSchema>

// combat.tex "Wounds": a wound the part can take, and at which tier of
// damage there it takes it — the table's row, authored per part so each
// creature's places take their own (see `PART_PRESETS`).
export const PartWoundSchema = z.object({
  name: str.default(''),
  tier: num.int().min(0).default(0),
  smash: z.boolean().default(false),
  effect: WoundEffectSchema.default('disable'),
  heal: num.default(0),
  affliction: z.lazy(() => AfflictionKeySchema).nullable().default(null),
  consequence: str.default(''),
}).strip()

export type PartWound = z.infer<typeof PartWoundSchema>

// combat.tex "Localized damage": "Each type of creature may have places that
// can specifically be aimed at" — the body is those places, each a part with
// a stable id that wounds and grips point at. `location` is the kind of place
// it is, what the rest of the rules read it as; what aiming at it does — the
// penalty, the cap on the tier the body takes, its flags and the wounds it
// takes — is the part's own. A part that grips holds the stack `itemId` names
// in `held`, '' when free; two parts naming the same stack are a two-handed
// grip (gear.tex "Small/One/Two hands"). Its natural weapon is the
// weapons.json entry it attacks with while empty (gear.tex "Unarmed": the
// hands of a humanoid); a paw or a jaw has one but takes no gear. A `lost`
// part was cut off: the slot keeps its shape for whatever puts it back.
// `cell` is the cell of the creature's footprint the part sits in; a part
// with none is spread over every cell the creature covers.
export const BodyPartSchema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  name: str.default(''),
  location: HitLocationSchema.default('chest'),
  grip: z.boolean().default(false),
  // whether the part takes hold of a surface to climb it (combat.tex
  // "Climbing": "hand, claw or other climbing equipment"); unsaid, a hand does
  climbs: z.boolean().optional(),
  itemId: str.default(''),
  naturalWeapon: str.default(''),
  aimPenalty: num.default(0),
  maxTier: num.nullable().default(null),
  flags: z.array(PartFlagSchema).default([]),
  wounds: z.array(PartWoundSchema).default([]),
  lost: z.boolean().default(false),
  cell: CoordSchema.nullable().default(null),
}).strip()

export type BodyPart = z.infer<typeof BodyPartSchema>

// A part of the kind as the humanoid's row describes it; what is given
// over it is kept.
export function presetPart(location: HitLocation, part: z.input<typeof BodyPartSchema> = {}): BodyPart {
  const { aimPenalty, maxTier, flags, wounds } = PART_PRESETS[location]
  return BodyPartSchema.parse({ location, aimPenalty, maxTier, flags: [...flags], wounds: wounds.map((w) => ({ ...w })), ...part })
}

const HUMANOID_BODY: z.input<typeof BodyPartSchema>[] = [
  { id: 'chest', name: 'chest', location: 'chest' },
  { id: 'head', name: 'head', location: 'head' },
  { id: 'handL', name: 'left hand', location: 'hand', grip: true, naturalWeapon: 'Unarmed' },
  { id: 'handR', name: 'right hand', location: 'hand', grip: true, naturalWeapon: 'Unarmed' },
  { id: 'legL', name: 'left leg', location: 'leg' },
  { id: 'legR', name: 'right leg', location: 'leg' },
]

// Every creature has a chest: the place a blow lands when none other is
// named. A body without one is given the humanoid's.
export const BodySchema = z.array(BodyPartSchema)
  .default(() => HUMANOID_BODY.map((part) => presetPart(part.location ?? 'chest', part)))
  .transform((body) => (body.some((part) => part.location === 'chest') ? body : [presetPart('chest', { id: 'chest', name: 'chest' }), ...body]))

// How many legs short — lost or wounded — leave the creature lame, and how
// many leave it unable to stand; authored per creature, as a body is.
export const StanceSchema = z.object({
  lameAt: num.default(1),
  proneAt: num.default(2),
}).strip()

export type Stance = z.infer<typeof StanceSchema>

// combat.tex "Wounds": a wound carried until it is healed, on the part it
// took, named by the part's own wound it is. `IL` is the healing it still
// needs — its "IL wound", "tracked separately from the main IL" — which
// starts at the wound's value unless what caused it says otherwise; healed
// to none, it is gone.
export const WoundSchema = z.object({
  name: str,
  part: str,
  IL: num.default(0),
  // abilities.tex "Bone Setting": "allow a wound to heal with rest. It heals
  // 0/1/2/2 per day" — what it heals at each day's end once set
  perDay: num.default(0),
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
  // abilities.tex "First Aid": "On a hit or crit, prevents bleeding that turn
  // completely" — until the round changes
  staunched: z.boolean().default(false),
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

export const AfflictionKeySchema =
  z.enum(Object.keys(AFFLICTIONS) as [AfflictionKey, ...AfflictionKey[]])

// combat.tex "Senses": an active sense is used to act, a reactive one to
// react; `penalty` is the sensory penalty of relying on it, a positive
// magnitude like an affliction's; `range` is how far it reaches in metres,
// null for as far as it can take anything in. `rangePenalty` is the distance
// band penalty (combat.tex "Distance bands").
type SenseDefaults = { name: string; rangePenalty: number; active: boolean; reactive: boolean; penalty: number; range: number | null; hasSense: boolean }

function makeSenseSchema(d: SenseDefaults) {
  return z.object({
    name: z.string().default(d.name),
    rangePenalty: z.number().default(d.rangePenalty),
    bonus: z.number().default(0),
    active: z.boolean().default(d.active),
    reactive: z.boolean().default(d.reactive),
    penalty: z.number().default(d.penalty),
    range: z.number().nullable().default(d.range),
    hasSense: z.boolean().default(d.hasSense),
  }).strip()
}

export const SenseSchema = makeSenseSchema({ name: '', rangePenalty: 5, active: true, reactive: true, penalty: 0, range: null, hasSense: true })

export type Sense = z.infer<typeof SenseSchema>

// combat.tex "Vision", "Hearing", "Smell", "Touch": each sense's defaults.
const senseEntry = (d: SenseDefaults) => makeSenseSchema(d).prefault({})

export const SensesSchema = z.object({
  vision: senseEntry({ name: 'Vision', rangePenalty: 3, active: true, reactive: true, penalty: 0, range: null, hasSense: true }),
  hearing: senseEntry({ name: 'Hearing', rangePenalty: 5, active: false, reactive: true, penalty: 3, range: null, hasSense: true }),
  smell: senseEntry({ name: 'Smell', rangePenalty: 5, active: true, reactive: false, penalty: 5, range: 0, hasSense: true }),
  touch: senseEntry({ name: 'Touch', rangePenalty: 100, active: true, reactive: true, penalty: 3, range: 0, hasSense: true }),
  synesthesia: senseEntry({ name: 'Synesthesia', rangePenalty: 100, active: true, reactive: true, penalty: 0, range: 0, hasSense: false }),
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
// `ap:`/`sta:` move the price of an action in ACTION_COSTS, `distance:` the
// penalty a way of shooting takes per 10m and `hit:` its test, `attribute:`
// the attribute on top of its training and `body:size` the creature's size).
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
  ...prefixed('distance', Object.keys(SHOTS) as ShotKind[]),
  ...prefixed('hit', Object.keys(SHOTS) as ShotKind[]),
  ...prefixed('attribute', Object.keys(AttributesSchema.shape) as (keyof Attributes)[]),
  ...prefixed('body', ['size'] as const),
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
export const DefenseKindSchema = z.enum(['none', 'evade', 'evasiveJump', 'block', 'intercept', 'evasion', 'guard', 'avoidExplosion', 'blockExplosion'])
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
  // the most the object blocked with absorbs, its RES; null with no block
  blockCap: num.nullable().default(null),
  shield: z.boolean().default(false),
  // combat.tex "Cover": a wall that breaks between the blow and the target,
  // which "acts as a shield, absorbing the damage taken by a certain amount
  // based on RES of the cover" before anything else meets the blow; its RES,
  // null with no such wall in the way.
  wall: z.object({ RES: num }).strip().nullable().default(null),
  bypass: z.boolean().default(false),
  bust: z.boolean().default(false),
  smash: z.boolean().default(false),
  // combat.tex "Fall damage": "the damage ignores armor"
  bare: z.boolean().default(false),
  // burn dealt straight to the flesh, which neither adds the burning counter
  // nor leaves the character burning (the table's ruling for abilities.tex
  // "Cauterization")
  sear: z.boolean().default(false),
  // combat.tex "Fall skill test": "Receiving a T1 injury or higher always
  // makes the character prone and stuns" — an interruption is a stun
  stuns: z.boolean().default(false),
}).strip()
export type Damage = z.infer<typeof DamageSchema>

// What damage came to on the one it landed on (rules/damage.ts `getOutcome`),
// and the steps of how it got there, each with the rule it follows.
export const OutcomeSchema = z.object({
  // combat.tex "Intercept": the blow never lands
  stopped: z.boolean().default(false),
  type: DamageKindSchema.default('blunt'),
  damage: num.default(0),
  // the armor value the damage was measured against
  armor: num.default(0),
  // null: below the armor, no injury
  tier: num.nullable().default(null),
  // each kind measured against its own armor value, before the choice; the
  // blunt one drives the blunt effects whichever kind is applied
  tiers: z.partialRecord(DamageKindSchema, num.nullable()).default({}),
  // the tier the body takes after the location's cap
  bodyTier: num.nullable().default(null),
  IL: num.default(0),
  bleed: num.default(0),
  // combat.tex "Wounds": the wound the tier causes, and the part it takes
  // (`heal` null: it takes the part off)
  wound: z.object({ name: str, heal: num.nullable(), part: z.object({ id: str, name: str }) }).nullable().default(null),
  afflictions: z.array(AfflictionKeySchema).default([]),
  // combat.tex "Interruption", "Stun": what cuts the target's action short,
  // and the AP a stun takes on top
  interruption: InterruptionSchema.default('none'),
  apLoss: num.default(0),
  dead: z.boolean().default(false),
  // combat.tex "Burning and radiant damage": the burning counter once the
  // burn received has been added and the damage applied; null when no burn
  // was received
  burning: num.nullable().default(null),
  // the physical damage that got past the defense and reached the armor
  arrived: z.object({ blunt: num, cut: num }).default({ blunt: 0, cut: 0 }),
}).strip()
export type Outcome = z.infer<typeof OutcomeSchema>

export const OutcomeStepSchema = z.object({ text: str, rule: str }).strip()
export type OutcomeStep = z.infer<typeof OutcomeStepSchema>

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
  // takes the affliction away instead (spells.tex "Defibrillate")
  cure: z.boolean().default(false),
}).strip()

// survival.tex "Healing": what medicine or magic mends — the IL, or the
// wound the producer puts it on instead ("Removes 4 IL or heals a wound by
// 4"); the bleed; a lost part put back, carrying a wound of `amount` IL
// ("Reattach Limb"); healing banked as a potion's is, spent over the next
// ET, a share of the nutrition of the food it is charged into ("Healing
// Food"); a body brought back to one IL short of death ("Revitalize").
export const HEAL_KINDS = ['injury', 'bleed', 'limb', 'potion', 'revive'] as const
export const HealEffectSchema = z.object({
  of: z.enum(HEAL_KINDS).default('injury'),
  amount: num.default(0),
  nutrition: num.default(0),
  // what the producer named: the wound (its index) healed instead of the IL,
  // the lost part put back
  wound: num.nullable().default(null),
  part: str.nullable().default(null),
}).strip()
export type HealEffect = z.infer<typeof HealEffectSchema>

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

// gear.tex "Net": what lands on one caught in the area — a tether to whoever
// threw it, `length` metres at most, slipped on a Prestidigitation test
// against the DL of the zone they were caught in; no DL for a zone is no
// tether there.
export const TetherEffectSchema = z.object({
  length: num.default(0),
  dl: z.object({
    critical: num.nullable().default(null),
    hit: num.nullable().default(null),
    graze: num.nullable().default(null),
  }).strip().default({ critical: null, hit: null, graze: null }),
}).strip()

// gear.tex "Equipment Breakage": an item put at risk by a collision. The
// producer works out the `chance` it gives way from the blow it took, the
// percentile `roll` was thrown with the action, and it breaks when the roll
// falls under the chance.
export const BreakEffectSchema = z.object({
  itemId: str.default(''),
  chance: num.default(0),
  roll: num.default(0),
}).strip()

// spells.tex "Spiritual Strike": a blow to the spirit — the STA it takes, a
// loss rather than STA spent, and the interruption it lands — as hard as
// the degree it lands at: `hit` in full, `graze` at half.
export const SpiritBlowSchema = z.object({
  STA: num.default(0),
  interruption: InterruptionSchema.default('none'),
}).strip()
export type SpiritBlow = z.infer<typeof SpiritBlowSchema>
const NO_BLOW = { STA: 0, interruption: 'none' } as const
export const SpiritEffectSchema = z.object({
  hit: SpiritBlowSchema.default(NO_BLOW),
  graze: SpiritBlowSchema.default(NO_BLOW),
}).strip()
export type SpiritEffect = z.infer<typeof SpiritEffectSchema>

export const EffectSchema = z.discriminatedUnion('type', [
  z.object({ ...EffectBase, type: z.literal('break'), effect: BreakEffectSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('spirit'), effect: SpiritEffectSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('cost'), effect: CostSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('buff'), effect: BuffSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('suppression'), effect: SuppressionSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('damage'), effect: DamageSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('affliction'), effect: AfflictionEffectSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('terrain'), effect: TerrainEffectSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('tether'), effect: TetherEffectSchema }).strip(),
  z.object({ ...EffectBase, type: z.literal('heal'), effect: HealEffectSchema }).strip(),
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
// What a target tests with: a skill, or their spirit (spells.tex "Spiritual
// Strike": SPI + 3xSM).
export const TestRollKeySchema = z.union([SkillKeySchema, z.literal('spirit')])
export type TestRollKey = z.infer<typeof TestRollKeySchema>

export const DeliveryTestSchema = z.object({
  roll: TestRollKeySchema,
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

// Something switched on and held: a toggle ability, a held spell, a curse
// carried until it is beaten, a potion taken, for the `ETs` it has left, or a
// light cast into an item (`itemId`), for the rest of the fight. The character keeps only the reference;
// the effects are read off the owning catalog, so nothing copied into state
// can go stale. A curse keeps the DL the test to beat it is rolled against
// (spells.tex "Curse": "until the target shrugs it off"); a held spell that
// links keeps who it is linked to, by character id, and one cast with gear
// the item it is held with.
export const ActiveEntrySchema = z.object({
  kind: z.enum(['ability', 'spell', 'curse', 'potion', 'light']),
  key: str,
  DL: num.optional(),
  itemId: str.optional(),
  ETs: num.optional(),
  // the size a held spell was cast at and the times its range was extended
  size: num.optional(),
  extend: num.optional(),
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
// `sustaining` names a spell the caster must be holding to cast this one,
// `active` an ability that must be in effect: a toggle switched on, or a
// passive one learned.
export const RequirementSchema = z.object({
  kind: z.enum(['ability', 'spell', 'gear', 'trainable', 'attribute', 'condition', 'sustaining', 'active']),
  name: str.default(''),
  level: num.default(0),
  op: z.enum(['>', '<', '>=', '<=']).default('>='),
  not: z.boolean().default(false), // "not X": the item must be absent
}).strip()
export type Requirement = z.infer<typeof RequirementSchema>

// A follow-up as data: what a landed strike offers someone, read by
// scene/rules/recipes.ts. Every word a recipe is written in is closed, and
// each is read there.
//
// `on` is when it fires. `defended`: a defense of `defenses` (any of the four
// when empty) made the strike come to one of `degrees`; the defender acts, at
// the attacker — only the strike's target, unless `defender` is `any`.
// `struck`: the strike came to one of `degrees` with `spent` bought, aimed at
// one of `locations`; its attacker acts, at its target. An empty list allows
// any.
export const RecipeEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('defended'),
    defenses: z.array(z.enum(DEFENSES)).default([]),
    degrees: z.array(DegreeSchema).default([]),
    defender: z.enum(['target', 'any']).default('target'),
  }).strip(),
  z.object({
    event: z.literal('struck'),
    degrees: z.array(DegreeSchema).default([]),
    spent: z.enum(HOP_PURCHASES).nullable().default(null),
    locations: z.array(HitLocationSchema).default([]),
  }).strip(),
])
export type RecipeEvent = z.infer<typeof RecipeEventSchema>

// What a recipe asks of the fight for one of its terms to apply: the opened
// strike made with another object than the defense it is opened from, or the
// struck target running or jumping.
export const RecipeConditionSchema = z.enum(['differentObjectFromOpener', 'targetInMotion'])
export type RecipeCondition = z.infer<typeof RecipeConditionSchema>

export const RecipeOpensSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('strike') }).strip(),
  // `along`: whether its actor may throw themselves along on a hit
  z.object({ kind: z.literal('grapple'), maneuver: z.enum(GRAPPLE_MANEUVERS), along: z.boolean().default(false) }).strip(),
])

// `followUp`: what a landed strike offers. `opens` is what the follow-up
// is; the rest is what it gets: `hit` to its attack, `cost` (when `costWhen`
// holds, or always), unresisted when `unresistedWhen` holds, and whether it
// draws opportunity attacks.
// `contestedReaction`: a strike of its holder's own in answer to a strike
// aimed at them, its die thrown with the attack's and the higher landing
// first (scene/rules/counter.ts); `hit` is what it gets.
export const RecipeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('followUp'),
    on: RecipeEventSchema,
    opens: RecipeOpensSchema,
    hit: num.default(0),
    cost: z.object({ operation: z.enum(['+', 'set']).default('+'), AP: num.default(0), STA: num.default(0) }).nullable().default(null),
    costWhen: RecipeConditionSchema.nullable().default(null),
    unresistedWhen: RecipeConditionSchema.nullable().default(null),
    drawsOpportunity: z.boolean().default(true),
  }).strip(),
  z.object({
    type: z.literal('contestedReaction'),
    hit: num.default(0),
  }).strip(),
])
export type Recipe = z.infer<typeof RecipeSchema>

// A capability a rule in the domain asks for by name, which an ability gives
// its holder for as long as it is learned (character/rules/effects.ts
// `hasGrant`). What each allows is the rule that asks for it, which cites
// the book.
export const GrantSchema = z.enum(['protectStep', 'advancingIntercept', 'stillReflex', 'fullCircleSweep', 'bowTraining', 'wizardSpells', 'clericSpells', 'softLanding', 'safeClimb', 'riskyClimb', 'climbUpright', 'clawGrip', 'climbLeap', 'humanoidHeight', 'spiritOfBattle'])
export type Grant = z.infer<typeof GrantSchema>

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
  recipes: z.array(RecipeSchema).default([]), // the actions this stage gives in a fight
  grants: z.array(GrantSchema).default([]), // the capabilities this stage gives while learned
  freeSpells: num.default(0), // spells learned with the stage, at no cost, among those the character has the knowledge for
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
// target until something resolves it (spells.tex "Curse"). `count` is how
// many the caster may aim a target effect at ("up to 10 creatures"), and
// `enhance` what one "Enhance Spell" adds to its number: a heal's amount, a
// buff's value.
const SpellEffectEnvelope = {
  target: z.enum(['self', 'target', 'area']).default('target'),
  count: num.default(1),
  enhance: num.default(0),
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
  // `fromGear` multiplies the damage of the gear the spell is cast with
  // instead of naming its own (spells.tex "Taser": 15 from the electrite's 10)
  z.object({ ...EffectBase, ...SpellEffectEnvelope, type: z.literal('damage'), effect: DamageSchema.pick({ damage: true, hardness: true, properties: true, force: true }), fromGear: num.nullable().default(null) }).strip(),
  z.object({ ...EffectBase, ...SpellEffectEnvelope, type: z.literal('affliction'), effect: AfflictionEffectSchema }).strip(),
  z.object({ ...EffectBase, ...SpellEffectEnvelope, type: z.literal('terrain'), effect: TerrainEffectSchema }).strip(),
  z.object({ ...EffectBase, ...SpellEffectEnvelope, type: z.literal('tether'), effect: TetherEffectSchema }).strip(),
  z.object({ ...EffectBase, ...SpellEffectEnvelope, type: z.literal('heal'), effect: HealEffectSchema }).strip(),
  // spells.tex "Spiritual Strike": launches a spiritual attack at the target;
  // what it is and the test it leaves are the attack's own, not the spell's
  z.object({ ...EffectBase, ...SpellEffectEnvelope, type: z.literal('spirit'), effect: z.object({}).strip().default({}) }).strip(),
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
  z.object({ ...EffectBase, ...OutcomeEffectEnvelope, type: z.literal('tether'), effect: TetherEffectSchema }).strip(),
  z.object({ ...EffectBase, ...OutcomeEffectEnvelope, type: z.literal('heal'), effect: HealEffectSchema }).strip(),
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
  name: str.default(''), // a knowledge name, lowercased: a formal knowledge's key or a specific knowledge's name
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
  // what firing a held spell again costs, without the casting test: its AP
  // and the charges it draws (the table's ruling); null for one that cannot
  repeat: z.object({ AP: num.default(0), ammo: num.default(0) }).strip().nullable().default(null),
  costText: str.default(''), // the book's cost field verbatim, for materials and charges the domain does not track
  knowledge: z.array(SpellKnowledgeRequirementSchema).default([]),
  // spells.tex "Requirements": what the spell cannot be learned without —
  // the spells, abilities and training it is learned from — and what it
  // cannot be cast without: the gear at hand, the spell held, the ability
  // in effect, the condition met. Every outer item is needed, any inner
  // alternative satisfies it, as an ability's are.
  requirements: z.array(z.array(RequirementSchema)).default([]),
  castRequirements: z.array(z.array(RequirementSchema)).default([]),
  DL: num.nullable().default(null), // casting DL; null while the book leaves it undecided
  // a held spell that links its caster to its targets: what each link adds
  // to the DL of every spell the caster casts while holding it; null for a
  // spell that links nobody
  linkDL: num.nullable().default(null),
  // spells.tex "Telepathic Link": "until the maximum distance is exceeded" —
  // the metres a link holds over; absent for a spell that links nobody
  linkRange: num.optional(),
  castRange: str.default(''),
  castArea: str.default(''),
  // spells.tex "Detonate Explosive": the spell sets off a charge already in
  // an object, within this many metres of the caster; null for one that
  // does not
  detonate: z.object({ range: num.default(0) }).strip().nullable().default(null),
  // spells.tex "Charged": what releases the charge a charged spell leaves in
  // its object; empty for any other spell
  triggers: z.array(ChargeTriggerSchema).default([]),
  // what a charged spell is charged into: the gear it is cast with, a
  // metal weapon at hand ("Taser", the table's ruling on metal), or a
  // portion of food at hand, released into whoever eats it ("Healing Food")
  chargeInto: z.enum(['gear', 'metalWeapon', 'food']).default('gear'),
  // the charges a cast draws from its gear's source ("+1 charge")
  ammo: num.default(0),
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

export const MovementKindSchema = z.enum(MOVEMENT_KINDS)
export type MovementKind = z.infer<typeof MovementKindSchema>

export const PostureSchema = z.enum(POSTURES)
export type Posture = z.infer<typeof PostureSchema>

// What a move is made at: a way of crossing cells or a change of posture.
export const MoveKindSchema = z.enum([...MOVEMENT_KINDS, ...POSTURES])
export type MoveKind = z.infer<typeof MoveKindSchema>

export const TerrainBrushSchema = z.enum(TERRAIN_BRUSHES)
export type TerrainBrush = z.infer<typeof TerrainBrushSchema>

// creating.tex "Races": what a race sets of a creature — its size and how it
// sits on the grid, its height, its toughness, senses, base movement, natural armor and
// body. Chosen only while the race is being made; picking a race copies them
// onto the character, whose own they then are.
const RaceBodyValues = {
  size: z.number().default(3),
  // creating.tex "Size and Space Occupation": the cells the creature covers,
  // as offsets from the cell it is placed by, facing direction 0; that cell
  // is always one of them
  footprint: z.array(CoordSchema).default(() => [{ q: 0, r: 0 }]),
  // creating.tex "Reach Multiplier (RM)": the creature's height in whole
  // metres, 2 for a humanoid of the common sizes
  height: num.int().nonnegative().default(2),
  TGH: z.number().default(0),
  senses: SensesSchema.partial().default({}).transform(v => SensesSchema.parse(v)),
  movement: MovementSchema.partial().default({}).transform(v => MovementSchema.parse(v)),
  // what the creature is under anything it wears — skin, fur, hide; the rows
  // of the gear.tex "Armors" table with no bulk, which are not items
  armor: ArmorSchema.partial().default({}).transform(v => ArmorSchema.parse(v)),
  body: BodySchema,
  stance: StanceSchema.partial().default({}).transform(v => StanceSchema.parse(v)),
}

export const RACE_BONUS_KEYS = [...AttributesSchema.keyof().options, ...TalentsSchema.keyof().options] as const
export const RaceBonusKeySchema = z.enum(RACE_BONUS_KEYS)
export type RaceBonusKey = z.infer<typeof RaceBonusKeySchema>

// creating.tex "Races": "Each playable race comes with its own bonuses to
// attributes and talents" ("Add the attribute bonuses after step 4") and its
// abilities ("Has the Fur ability"). A race nobody plays (a monster's, an
// animal's) is not offered to players.
const RaceTraits = {
  name: str.default(''),
  description: str.default(''),
  playable: z.boolean().default(true),
  bonuses: z.partialRecord(RaceBonusKeySchema, num).default({}),
  abilities: z.array(str).default([]),
}

export const RaceSchema = z.object({ ...RaceTraits, ...RaceBodyValues }).strip()
export type Race = z.infer<typeof RaceSchema>

// A race being made: its traits, kept on the character only while the race
// is the first step of making it. Committing writes them into the character
// and forgets the race.
export const RaceDraftSchema = z.object(RaceTraits).strip()
export type RaceDraft = z.infer<typeof RaceDraftSchema>

const CharacterValues = {
  id: z.string().default(() => crypto.randomUUID()),
  name: z.string().default(''),

  trainables: TrainablesSchema.partial().default({}).transform(v => TrainablesSchema.parse(v)),
  specificKnowledges: SpecificKnowledgesSchema,
  ...RaceBodyValues,
  
  hasGauntlets: z.number().default(0),
  hasHelm: z.number().default(0),
  // gear.tex "Closed helmet": the visor raised; the helmet's penalties and its
  // guard against a bypass at the head hold only while it is down
  visorOpen: z.boolean().default(false),
  
  // the armor item being worn over it, if any (gear.tex "Donning and Doffing armor")
  worn: ItemSchema.nullable().default(null),
  held: z.array(ItemSchema).default([]),
  // gear.tex "Shields": a shield carries its own strap and is slid to the
  // back rather than stored in a container; one back, one shield
  onBack: ItemSchema.nullable().default(null),
  containers: z.record(z.string(), ContainerSchema).default({}),

  abilities: z.record(z.string(), TrainableSchema).default({}), // by ability family: the level is the stages learned, XP the training toward the next
  spells: z.record(z.string(), LearnedSpellSchema).default({}), // keyed into the spell catalog

  // creating.tex "Character Creation", "Step 2: Race": the race being made
  // while the character is in its first step; null once it is committed,
  // and for every character made before races
  raceDraft: RaceDraftSchema.nullable().default(null),

  // creating.tex "Limit Stress Actions": chosen once, null while unchosen
  limitStress: z.enum(LIMIT_STRESS_ACTIONS).nullable().default(null),

  notes: z.string().default(''),
}


export const BaseCharacterSchema = z.object({

  // Free-form category labels used only to group characters in the sidebar.
  // The first tag is the top-level group, the second the sub-group, and so on;
  // a character may carry any number of tags (including none -> "untagged").
  // This is the only categorization mechanism — there are no folders on disk.
  tags: z.array(z.string()).default([]),
  type: z.literal('base').default('base'),
  // creating.tex "Character Creation", Step 3: the money the wealth focus
  // gave, in coppers, that the gear the character is made with is bought
  // from; null for a character not made by the book's steps
  startingWealth: num.nullable().default(null),
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

// creating.tex "Character Creation", Step 2: the five foci, each given its own
// priority from A to E.
export const FOCI = ['CON', 'SPI', 'INT', 'DEX', 'wealth'] as const
export const FocusSchema = z.enum(FOCI)
export type Focus = z.infer<typeof FocusSchema>
export const PRIORITIES = ['A', 'B', 'C', 'D', 'E'] as const
export const PrioritySchema = z.enum(PRIORITIES)
export type Priority = z.infer<typeof PrioritySchema>

export const TrainableKeySchema = z.enum(Object.keys(TrainablesSchema.shape) as [keyof Trainables, ...(keyof Trainables)[]])

// A character being made by the book's steps. `character` is where it starts:
// attributes at 8 and the choices made; the race is kept apart and put on it
// when prices are worked out. What is bought is kept as levels on top of that
// start, never as XP spent, so its price always follows the talents the
// character has at the moment.
export const CreationDraftSchema = z.object({
  character: BaseCharacterSchema,
  race: RaceSchema.nullable().default(null),
  priorities: z.record(FocusSchema, PrioritySchema).default({ CON: 'A', SPI: 'B', INT: 'C', DEX: 'D', wealth: 'E' }),
  trainables: z.partialRecord(TrainableKeySchema, num).default({}),
  progress: z.partialRecord(TrainableKeySchema, num).default({}), // the XP put toward the next level of a skill, proficiency or knowledge, short of its price
  abilities: z.record(z.string(), num).default({}), // by ability family: the level bought up to, the race's stages free
  // the spells chosen, by key: the method each is learned by, and whether it
  // was claimed free from an ability (Magic Theory)
  spells: z.record(z.string(), z.object({ method: SpellMethodSchema, free: z.boolean().default(false) })).default({}),
}).strip()
export type CreationDraft = z.infer<typeof CreationDraftSchema>

export type CharacterUpdater = (c: Character) => Character
export type CampaignCharacterUpdater = (c: Character) => CampaignCharacter

export interface Lens<T, V> {
  get: (subject: T) => V;
  set: (subject: T, value: V) => T;
}