import { z } from 'zod'
import { AFFLICTIONS } from './tables'

const num = z.number()
const str = z.string()

export const ArmorSchema = z.object({
  name: z.string().default('Skin'),
  RES: z.number().default(0),
  TGH: z.number().default(0),
  INS: z.number().default(0),
  prot: z.number().default(0),
  cover: z.number().default(0),
  penalty: z.number().default(0),
  type: z.enum(['light', 'medium', 'heavy']).default('light'),
}).strip()

export type Armor = z.infer<typeof ArmorSchema>

export const SkillsSchema = z.object({
  strike: num.default(0),
  defend: num.default(0),
  reflex: num.default(0),
  accuracy: num.default(0),
  grapple: num.default(0),
  SD: num.default(0),

  stealth: num.default(0),
  prestidigitation: num.default(0),
  balance: num.default(0),
  strength: num.default(0),
  health: num.default(0),
  swim: num.default(0),
  climb: num.default(0),

  knowledge: num.default(0),
  explore: num.default(0),
  cunning: num.default(0),
  will: num.default(0),
  charm: num.default(0),
  stress: num.default(0),
  devotion: num.default(0),

  combustion: num.default(0),
  eletromag: num.default(0),
  radiation: num.default(0),
  entropy: num.default(0),
  biomancy: num.default(0),
  telepathy: num.default(0),
  animancy: num.default(0),
}).strip()

export type Skills = z.infer<typeof SkillsSchema>

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

  impact: num.default(0),
  heavyMod: num.default(0),
  penMod: num.default(0),

  range: str.default('short'),

  RES: num.default(0),
  TGH: num.default(0),

  AP: num.default(0),
  deflection: num.default(0),

  props: str.default(''),
}).strip()

export type WeaponAttack = z.infer<typeof WeaponAttackSchema>

export const WeaponSchema = z.object({
  name: str.default(''),
  penalty: num.default(0),
  scale: num.default(3),
  attacks: z.array(WeaponAttackSchema).default([]),
}).strip()

export type Weapon = z.infer<typeof WeaponSchema>

export const ItemSchema = z.object({
  size: num.default(0),
  name: str.default(''),
  description: str.default(''),
}).strip()

export type Item = z.infer<typeof ItemSchema>

export const ContainerSchema = z.object({
  name: str.default(''),
  capacity: num.default(0),
  penalty: num.default(0),
  items: z.array(ItemSchema).default([]),
}).strip()

export type Container = z.infer<typeof ContainerSchema>

export const InjuriesSchema = z.object({
  light: z.array(num).default([0, 0, 0, 0, 0, 0]),
  serious: z.array(num).default([0, 0, 0]),
  deadly: z.array(num).default([0, 0]),
}).strip()

export type Injuries = z.infer<typeof InjuriesSchema>

export const ResourcesSchema = z.object({
  AP: num.default(0),
  STA: num.default(0),
  hunger: num.default(0),
  thirst: num.default(0),
  exhaustion: num.default(0),
}).strip()

export type Resources = z.infer<typeof ResourcesSchema>

export const AfflictionItemSchema = z.object({
  mobility: num.optional(),
  vision: num.optional(),
  mental: num.optional(),
  health: num.optional(),
  injury: num.optional(),
  controlable: z.boolean().default(false),
}).strip()

export type AfflictionItem = z.infer<typeof AfflictionItemSchema>

export const CharacterAfflictionsSchema =
  z.array(z.string()).default([])

export type CharacterAfflictions =
  z.infer<typeof CharacterAfflictionsSchema>



export const CharacteristicsSchema = z.object({
  size: z.number().default(3),

  STR: z.number().default(10),
  AGI: z.number().default(10),
  STA: z.number().default(10),

  CON: z.number().default(0),
  INT: z.number().default(0),
  SPI: z.number().default(0),
  DEX: z.number().default(0),

  melee: z.number().default(0),
  ranged: z.number().default(0),
  detection: z.number().default(0),
  spellcast: z.number().default(0),
  conviction1: z.number().default(0),
  conviction2: z.number().default(0),
  devotion: z.number().default(0),

  RES: z.number().default(5),
  INS: z.number().default(5),
  TGH: z.number().default(5),
}).strip()

export type Characteristics = z.infer<typeof CharacteristicsSchema>

export type AfflictionKey = keyof typeof AFFLICTIONS

const AfflictionKeySchema =
  z.enum(Object.keys(AFFLICTIONS) as [AfflictionKey, ...AfflictionKey[]])


export const CampaignValuesSchema = z.object({
  injuries: InjuriesSchema,
  afflictions: z.array(AfflictionKeySchema).default([]),
  resources: ResourcesSchema,
  hasActionSurge: z.boolean().default(false),
})

export type CampaignValues = z.infer<typeof CampaignValuesSchema>


export const CharacterSchema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  path: z.string(),
  name: z.string().default(''),

  characteristics: CharacteristicsSchema.partial().default({}).transform(v => CharacteristicsSchema.parse(v)),
  skills: SkillsSchema.partial().default({}).transform(v => SkillsSchema.parse(v)),
  movement: MovementSchema.partial().default({}).transform(v => MovementSchema.parse(v)),
  
  hasGauntlets: z.number().default(0),
  hasHelm: z.number().default(0),
  
  armor: ArmorSchema.partial().default({}).transform(v => ArmorSchema.parse(v)),
  weapons: z.record(z.string(), WeaponSchema).default({}),
  containers: z.record(z.string(), ContainerSchema).default({}),

  notes: z.string().default(''),

  // runtime-capable (optional)
  fightName: z.string().optional(),
  injuries: InjuriesSchema.optional(),
  afflictions: z.array(AfflictionKeySchema).optional(),
  resources: ResourcesSchema.optional(),
  hasActionSurge: z.boolean().optional(),
}).strip()

export type Character = z.infer<typeof CharacterSchema>

export const CampaignCharacterSchema = z.object({
  ...CharacterSchema.shape,
  ...CampaignValuesSchema.shape,
})

export type CampaignCharacter = z.infer<typeof CampaignCharacterSchema>

// export type Afflictions = {
//   prone: AfflictionItem,
//   grappled: AfflictionItem,
//   immobile: AfflictionItem,
//   limp: AfflictionItem,
//   dazzled: AfflictionItem,
//   blind: AfflictionItem,
//   fear: AfflictionItem,
//   rage: AfflictionItem,
//   confused: AfflictionItem,
//   distracted: AfflictionItem,
//   dominated: AfflictionItem,
//   seduced: AfflictionItem,
//   malnourished: AfflictionItem,
//   thirsty: AfflictionItem,
//   dehydrated: AfflictionItem,
//   tired: AfflictionItem,
//   exhausted: AfflictionItem,
//   weakened: AfflictionItem,
//   sick: AfflictionItem,
// }


export type CharacterUpdater = (c: Character) => Character
export type CampaignCharacterUpdater = (c: CampaignCharacter) => CampaignCharacter