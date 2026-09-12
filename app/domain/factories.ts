import z from 'zod'
import { ArmorSchema, CampaignCharacter, CampaignCharacterSchema, BaseCharacterSchema, WeaponSchema, ContainerSchema, BaseCharacter, SurgeKindSchema, Trainables } from './types'
import { getSTA } from './character/lenses/characteristics'
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
    weapons: parsedCharacter.weapons ?? emptyCharacter.weapons,
    containers: parsedCharacter.containers ?? emptyCharacter.containers,
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

  return{
    ...addBaseValues(campaignCharacter, parsed.data),
    type: 'campaign',
    afflictions: parsed.data.afflictions ?? campaignCharacter.afflictions,
    resources: {
      ...parsed.data.resources ?? {...campaignCharacter.resources, STA: getSTA(campaignCharacter), AP: 8},
    },
    injuries: {
      ...parsed.data?.injuries ?? campaignCharacter.injuries,
    },
    usedSurge: parsed.data.usedSurge ?? campaignCharacter.usedSurge,
  }
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
  TGH: z.number().optional(),
  movement: z.record(z.string(), safeNumber).optional(),

  hasGauntlets: z.number().optional(),
  hasHelm: z.number().optional(),

  armor: ArmorSchema.optional(),
  weapons: z.record(z.string(), WeaponSchema).optional(),
  containers: z.record(z.string(), ContainerSchema).optional(),

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
};

export const CampaignCharacterIngestSchema = z.object({
  ...CharacterIngestValues,
  ...ResourceIngestValues,
}).strip();


export type CharacterIngestType = z.infer<typeof CharacterIngestSchema>
export type CampaignCharacterIngestType = z.infer<typeof CampaignCharacterIngestSchema>