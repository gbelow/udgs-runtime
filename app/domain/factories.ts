import z from 'zod'
import { CampaignCharacter, CampaignCharacterSchema, Character, CharacterSchema } from './types'

export const EMPTY_CHARACTER: Character =  CharacterSchema.parse({ path: '',})

export function makeCharacter(raw: unknown): Character {
  if (typeof raw !== 'object' || raw === null) {
    return EMPTY_CHARACTER
  }

  const parsed = CharacterIngestSchema.safeParse(raw)

  if (!parsed.success) {
    return EMPTY_CHARACTER
  }

  return {
    ...EMPTY_CHARACTER,
    ...parsed.data,
    
    // deep merge the important nested objects
    characteristics: {
      ...EMPTY_CHARACTER.characteristics,
      ...parsed.data.characteristics,
    },
    skills: {
      ...EMPTY_CHARACTER.skills,
      ...parsed.data.skills,
    },
    movement: {
      ...EMPTY_CHARACTER.movement,
      ...parsed.data.movement,
    },
    armor: {
      ...EMPTY_CHARACTER.armor,
      ...parsed.data.armor,
    },
    weapons: parsed.data.weapons ?? EMPTY_CHARACTER.weapons,
    containers: parsed.data.containers ?? EMPTY_CHARACTER.containers,
  }
}

export function makeCampaignCharacter(raw: unknown, character: Character):CampaignCharacter {

  const parsed = CharacterResourceIngestSchema.safeParse(raw)
  const campaignCharacter = CampaignCharacterSchema.parse(character)

  if (!parsed.success) {
    return campaignCharacter
  }

  return{
    ...character,
    afflictions: parsed.data.afflictions ?? campaignCharacter.afflictions,
    resources: {
      ...parsed.data.resources ?? {...campaignCharacter.resources, STA: campaignCharacter.characteristics.STA},
    },
    injuries: {
      ...parsed.data.injuries ?? campaignCharacter.injuries,
    },
    hasActionSurge: parsed.data.hasActionSurge ?? campaignCharacter.hasActionSurge,
  }

}

const safeNumber = z.preprocess(
  v => {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  },
  z.number().default(1)
)

export const CharacterIngestSchema = z.object({
  id: z.string().optional(),
  path: z.string().optional(),
  name: z.string().optional(),

  characteristics: z.record(z.string(), z.any()).optional(),
  skills: z.record(z.string(), z.any()).optional(),
  movement: z.record(z.string(), safeNumber).optional(),

  hasGauntlets: z.number().optional(),
  hasHelm: z.number().optional(),

  armor: z.record(z.string(), z.any()).optional(),
  weapons: z.record(z.string(), z.any()).optional(),
  containers: z.record(z.string(), z.any()).optional(),

  notes: z.string().optional(),

  
}).strip()



export const CharacterResourceIngestSchema = z.object({
  injuries: z.any().optional(),
  afflictions: z.array(z.any()).optional(),
  resources: z.any().optional(),
  hasActionSurge: z.boolean().optional(),
  
}).strip()

