import z from 'zod'
import { ArmorSchema, CampaignCharacter, CampaignCharacterSchema, BaseCharacterSchema, ContainerSchema, BaseCharacter, SurgeKindSchema, Trainables, BodyPartSchema, BodySchema, HitLocationSchema, presetPart, StanceSchema, ItemSchema, BodyPart, Item, Wound, WoundSchema, LearnedSpell, LearnedSpellSchema, Trainable, CoordSchema, MovementSchema, RaceDraftSchema, RaceSchema, RACE_BONUS_KEYS, CreationDraftSchema, type CreationDraft, type RaceDraft, type Race, type RaceBonusKey } from './types'
import { getSTA } from './character/rules/characteristics'
import { getRaceOf } from './character/rules/race'
import { getPresetFootprint, isSoundFootprint, settleParts } from './character/rules/footprint'
import { isBaseCharacter } from './utils'
import { heldAbility } from './abilities'
import { CREATION_ATTRIBUTE } from './tables'

// A trainable's `name` and `type` are authored by the schema group it belongs to,
// never by the incoming data: an ingested trainable supplies a value, not an
// identity. Merging per field rather than per trainable also keeps a partial
// entry from dropping the fields it does not mention. A value that is not a
// number reads as the default.
function mergeTrainables(
  defaults: Trainables,
  incoming: Record<string, unknown> | undefined,
): Trainables {
  if (!incoming) return defaults
  const entries = Object.entries(defaults).map(([key, base]) => {
    const raw = incoming[key]
    if (raw === null || typeof raw !== 'object') return [key, base]
    const value = 'value' in raw && typeof raw.value === 'number' && Number.isFinite(raw.value) ? raw.value : base.value
    return [key, { ...base, ...raw, value, type: base.type }]
  })
  return Object.fromEntries(entries) as Trainables
}

// A learned spell that is not an object is not a learned spell; one that is
// gets its missing fields defaulted like any other ingested record.
function mergeSpells(incoming: Record<string, unknown> | undefined): Record<string, LearnedSpell> {
  if (!incoming) return {}
  return Object.fromEntries(
    Object.entries(incoming)
      .filter(([, raw]) => raw !== null && typeof raw === 'object')
      .map(([key, raw]) => [key, LearnedSpellSchema.parse(raw)]),
  )
}

// An ability held is a trainable of its family: what is not an object is
// dropped, and a level or XP that is not a number reads as 0.
function mergeAbilities(incoming: Record<string, unknown> | undefined): Record<string, Trainable> {
  if (!incoming) return {}
  return Object.fromEntries(
    Object.entries(incoming)
      .filter((entry): entry is [string, Record<string, unknown>] => entry[1] !== null && typeof entry[1] === 'object')
      .map(([key, raw]) => [key, { ...heldAbility(key, finite(raw.value)), XP: finite(raw.XP) }]),
  )
}

const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

function addBaseValues(emptyCharacter: BaseCharacter, parsedCharacter: CharacterIngestType): BaseCharacter
function addBaseValues(emptyCharacter: CampaignCharacter, parsedCharacter: CampaignCharacterIngestType): CampaignCharacter
function addBaseValues (emptyCharacter: BaseCharacter | CampaignCharacter, parsedCharacter: CharacterIngestType | CampaignCharacterIngestType){

  return settleFootprint({
    ...emptyCharacter,
    ...parsedCharacter,
    footprint: emptyCharacter.footprint,
    
    // deep merge the important nested objects
    trainables: mergeTrainables(emptyCharacter.trainables, parsedCharacter.trainables),
    movement: MovementSchema.parse({
      ...emptyCharacter.movement,
      ...parsedCharacter.movement,
    }),
    armor: {
      ...emptyCharacter.armor,
      ...parsedCharacter.armor,
    },
    containers: parsedCharacter.containers ?? emptyCharacter.containers,
    spells: mergeSpells(parsedCharacter.spells),
    abilities: mergeAbilities(parsedCharacter.abilities),
    stance: {
      ...emptyCharacter.stance,
      ...parsedCharacter.stance,
    },
    ...reconcileGrip(uniqueParts(parsedCharacter.body ? readBody(parsedCharacter.body) : emptyCharacter.body), parsedCharacter.held ?? emptyCharacter.held),
  }, parsedCharacter.footprint)
}

// A footprint that is not one piece of whole cells around the anchor is read
// as the blob of the creature's size, and a part on a cell the footprint does
// not cover sits on the anchor.
function settleFootprint<C extends BaseCharacter | CampaignCharacter>(c: C, raw: unknown): C {
  const read = z.array(CoordSchema).safeParse(raw)
  const footprint = read.success && isSoundFootprint(read.data) ? read.data : getPresetFootprint(c, 'blob')
  return { ...c, footprint, body: settleParts(footprint, c.body) }
}

// A race's traits, field by field: what is not of the right kind is the
// default, a bonus only to an attribute or a talent and only a number.
function readRaceTraits(raw: unknown): RaceDraft {
  const traits = RaceTraitsIngestSchema.safeParse(raw)
  const data = traits.success ? traits.data : {}
  const bonuses = knownNumbers(data.bonuses, Object.fromEntries(RACE_BONUS_KEYS.map((key) => [key, 0])) as Record<RaceBonusKey, number>)
  return RaceDraftSchema.parse({ ...data, bonuses, abilities: data.abilities?.filter((a) => typeof a === 'string') ?? [] })
}

const RaceTraitsIngestSchema = z.object({
  name: z.string().catch(''),
  description: z.string().catch(''),
  playable: z.boolean().catch(true),
  bonuses: z.unknown(),
  abilities: z.array(z.unknown()).catch([]),
}).partial()

// A race file, read as lossily as a character: what it sets of the creature
// is read the way a character's is, its traits field by field. The body is
// bare.
export function makeRace(raw: unknown): Race {
  return getRaceOf(makeRaceHolder(raw)) ?? RaceSchema.parse({})
}

// A race file read as the character that holds it while it is edited: what it
// sets of the creature on the character, its traits as the race being made.
// This is the only character that carries race traits; makeCharacter never
// does.
export function makeRaceHolder(raw: unknown = {}): BaseCharacter {
  return { ...makeCharacter(raw), raceDraft: readRaceTraits(raw) }
}

// A part is read over the humanoid's row for its kind, so what it does not
// say — its wounds, its penalty, its flags — is the book's; a cell that does
// not parse spreads it over the whole body, a part that does not parse is dropped, and a body
// left without a chest is given one.
function readBody(raw: Record<string, unknown>[]): BodyPart[] {
  return BodySchema.parse(raw.flatMap((entry) => {
    const kind = HitLocationSchema.safeParse(entry.location)
    const cell = CoordSchema.safeParse(entry.cell)
    const part = BodyPartSchema.safeParse({ ...presetPart(kind.success ? kind.data : 'chest'), ...entry, cell: cell.success ? cell.data : null })
    return part.success ? [part.data] : []
  }))
}

// Wounds and grips point at a part by its id, so two parts sharing one would
// be one part to them: the first keeps the id and the rest are dropped.
function uniqueParts(body: BodyPart[]): BodyPart[] {
  const seen = new Set<string>()
  return body.filter((part) => !seen.has(part.id) && !!seen.add(part.id))
}

// A hand names the stack it holds and every held stack is in some hand. Data
// that says otherwise — a hand on a stack that is not there, a part that
// cannot grip or is gone holding one, a stack no hand is on — is read as the
// hand being free and the stack gone.
function reconcileGrip(body: BodyPart[], held: Item[]): { body: BodyPart[]; held: Item[] } {
  const stacks = new Set(held.map((item) => item.id))
  const gripping = body.map((part) => (part.grip && !part.lost && stacks.has(part.itemId) ? part : { ...part, itemId: '' }))
  const gripped = new Set(gripping.map((part) => part.itemId))
  return {
    body: gripping,
    held: held.filter((item) => gripped.has(item.id)),
  }
}

export function makeCharacter(raw: unknown, tags?: string[]): BaseCharacter {
  const emptyCharacter: BaseCharacter =  BaseCharacterSchema.parse({ tags: tags ?? [] })
  if (typeof raw !== 'object' || raw === null) return emptyCharacter

  const parsed = CharacterIngestSchema.safeParse({...raw, type: 'base'})
  if (!parsed.success)  return emptyCharacter

  const merged = addBaseValues(emptyCharacter, parsed.data)
  if(isBaseCharacter(merged)) return merged

  return emptyCharacter
}

// creating.tex "Character Creation", Step 4: a character being made starts
// with 8 in every attribute. It keeps the id and name of the one it replaces.
export function makeCreationStart(from: { id?: string; name?: string } = {}): BaseCharacter {
  const attribute = { value: CREATION_ATTRIBUTE }
  return makeCharacter({ ...from, trainables: { STR: attribute, AGI: attribute, STA: attribute } })
}

export function makeCreationDraft(): CreationDraft {
  return CreationDraftSchema.parse({ character: makeCreationStart() })
}

export function makeCampaignCharacter(raw: unknown): CampaignCharacter {

  const campaignCharacter = CampaignCharacterSchema.parse({})
  if (typeof raw !== 'object' || raw === null) {
    return campaignCharacter
  }
  
  const parsed = CampaignCharacterIngestSchema.safeParse({...raw, type: 'campaign'})

  if (!parsed.success) {
    return campaignCharacter
  }

  const based = addBaseValues(campaignCharacter, parsed.data)
  return{
    ...based,
    type: 'campaign',
    afflictions: parsed.data.afflictions ?? campaignCharacter.afflictions,
    // a fresh character starts full; whatever the raw carries overrides that
    // field by field, so a partial record still lands on a complete one
    resources: {
      ...campaignCharacter.resources,
      STA: getSTA(campaignCharacter),
      AP: 8,
      ...knownNumbers(parsed.data.resources, campaignCharacter.resources),
    },
    injuries: {
      ...campaignCharacter.injuries,
      ...parsed.data?.injuries,
      wounds: readWounds(parsed.data?.injuries?.wounds, based.body),
    },
    usedSurge: parsed.data.usedSurge ?? campaignCharacter.usedSurge,
    runsFree: parsed.data.runsFree ?? campaignCharacter.runsFree,
  }
}

// A wound is on a part and is one of the wounds that part takes: one whose
// part the body does not have, or has lost, or that the part does not take,
// is on nothing and is read as healed.
function readWounds(raw: unknown, body: BodyPart[]): Wound[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const wound = WoundSchema.safeParse(entry)
    const part = wound.success ? body.find((p) => p.id === wound.data.part && !p.lost) : undefined
    return wound.success && part?.wounds.some((w) => w.name === wound.data.name) ? [wound.data] : []
  })
}

const CharacterIngestValues = {
  id: z.string().optional(),
  name: z.string().optional(),

  trainables: z.record(z.string(), z.any()).optional(),
  knowledges: z.record(z.string(), z.any()).optional(),
  size: z.number().optional(),
  footprint: z.unknown().optional(),
  TGH: z.number().optional(),
  movement: z.record(z.string(), z.unknown()).optional(),

  hasGauntlets: z.number().optional(),
  hasHelm: z.number().optional(),
  visorOpen: z.boolean().optional(),

  armor: ArmorSchema.optional(),
  worn: ItemSchema.nullable().optional(),
  body: z.array(z.record(z.string(), z.unknown())).optional(),
  stance: StanceSchema.partial().optional(),
  held: z.array(ItemSchema).optional(),
  onBack: ItemSchema.nullable().optional(),
  containers: z.record(z.string(), ContainerSchema).optional(),

  abilities: z.record(z.string(), z.unknown()).optional().catch(undefined),
  spells: z.record(z.string(), z.any()).optional(),

  notes: z.string().optional(), 
}

export const CharacterIngestSchema = z.object({
  tags: z.array(z.string()).optional(),
  ...CharacterIngestValues
}).strip()

export const ResourceIngestValues = {
  injuries: z.any().optional(),
  afflictions: z.array(z.any()).optional(),
  resources: z.any().optional(),
  usedSurge: SurgeKindSchema.nullable().optional(),
  runsFree: z.boolean().optional(),
  active: z.array(z.any()).optional(),
};

export const CampaignCharacterIngestSchema = z.object({
  ...CharacterIngestValues,
  ...ResourceIngestValues,
}).strip();


export type CharacterIngestType = z.infer<typeof CharacterIngestSchema>
export type CampaignCharacterIngestType = z.infer<typeof CampaignCharacterIngestSchema>

// The fields of `raw` that `shape` also has and that hold a finite number —
// the lossy read every ingested record gets.
function knownNumbers<T extends Record<string, number>>(raw: unknown, shape: T): Partial<T> {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Partial<T> = {}
  for (const key of Object.keys(shape) as (keyof T)[]) {
    const value = (raw as Record<string, unknown>)[key as string]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value as T[keyof T]
  }
  return out
}
