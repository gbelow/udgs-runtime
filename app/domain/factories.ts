import z from 'zod'
import { ArmorSchema, CampaignCharacter, CampaignCharacterSchema, BaseCharacterSchema, ContainerSchema, BaseCharacter, SurgeKindSchema, Trainables, BodyPartSchema, StanceSchema, ItemSchema, BodyPart, Item, Wound, WoundSchema, LearnedSpell, LearnedSpellSchema, ShapeSchema } from './types'
import { getSTA } from './character/rules/characteristics'
import { isBaseCharacter } from './utils'

// A trainable's `name` and `type` are authored by the schema group it belongs to,
// never by the incoming data: an ingested trainable supplies a value, not an
// identity. Merging per field rather than per trainable also keeps a partial
// entry from dropping the fields it does not mention.
function mergeTrainables(
  defaults: Trainables,
  incoming: Record<string, unknown> | undefined,
): Trainables {
  if (!incoming) return defaults
  const entries = Object.entries(defaults).map(([key, base]) => {
    const raw = incoming[key]
    if (raw === null || typeof raw !== 'object') return [key, base]
    return [key, { ...base, ...raw, type: base.type }]
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

function addBaseValues(emptyCharacter: BaseCharacter, parsedCharacter: CharacterIngestType): BaseCharacter
function addBaseValues(emptyCharacter: CampaignCharacter, parsedCharacter: CampaignCharacterIngestType): CampaignCharacter
function addBaseValues (emptyCharacter: BaseCharacter | CampaignCharacter, parsedCharacter: CharacterIngestType | CampaignCharacterIngestType){

  return {
    ...emptyCharacter,
    ...parsedCharacter,
    
    // deep merge the important nested objects
    trainables: mergeTrainables(emptyCharacter.trainables, parsedCharacter.trainables),
    movement: {
      ...emptyCharacter.movement,
      ...parsedCharacter.movement,
    },
    armor: {
      ...emptyCharacter.armor,
      ...parsedCharacter.armor,
    },
    containers: parsedCharacter.containers ?? emptyCharacter.containers,
    spells: mergeSpells(parsedCharacter.spells),
    stance: {
      ...emptyCharacter.stance,
      ...parsedCharacter.stance,
    },
    ...reconcileGrip(uniqueParts(parsedCharacter.body ?? emptyCharacter.body), parsedCharacter.held ?? emptyCharacter.held),
  }
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
  }
}

// A wound is on a part: one whose part the body does not have, or has lost,
// is on nothing and is read as healed.
function readWounds(raw: unknown, body: BodyPart[]): Wound[] {
  const whole = new Set(body.filter((part) => !part.lost).map((part) => part.id))
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const wound = WoundSchema.safeParse(entry)
    return wound.success && whole.has(wound.data.part) ? [wound.data] : []
  })
}

const safeNumber = z.preprocess(
  v => {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  },
  z.number().default(1)
)


const CharacterIngestValues = {
  id: z.string().optional(),
  name: z.string().optional(),

  trainables: z.record(z.string(), z.any()).optional(),
  knowledges: z.record(z.string(), z.any()).optional(),
  size: z.number().optional(),
  shape: ShapeSchema.optional(),
  TGH: z.number().optional(),
  movement: z.record(z.string(), safeNumber).optional(),

  hasGauntlets: z.number().optional(),
  hasHelm: z.number().optional(),
  visorOpen: z.boolean().optional(),

  armor: ArmorSchema.optional(),
  worn: ItemSchema.nullable().optional(),
  body: z.array(BodyPartSchema).optional(),
  stance: StanceSchema.partial().optional(),
  held: z.array(ItemSchema).optional(),
  containers: z.record(z.string(), ContainerSchema).optional(),

  abilities: z.array(z.string()).optional(),
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
