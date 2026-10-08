import { z } from 'zod'
import { CampaignCharacterSchema, DegreeSchema } from '../types'
import { EXPLORATION_ACTIONS } from '../lists'
import type { CombatState } from '../combat/types'

// What a character spends the coming ET on. Whoever has none is idle.
export const ETPlanSchema = z.enum([...EXPLORATION_ACTIONS, 'rest'])
export type ETPlan = z.infer<typeof ETPlanSchema>

// survival.tex "Exhaustion": the Will test a character made at the start of
// the last ET.
export const ExhaustionRollSchema = z.object({
  die: z.number(),
  score: z.number(),
  DL: z.number(),
  degree: DegreeSchema,
})
export type ExhaustionRoll = z.infer<typeof ExhaustionRollSchema>

// The campaign above every scene: the roster of everyone in play who is not
// in a fight, and the clock all of them share.
export const CampaignStateSchema = z.object({
  characters: z.record(z.string(), CampaignCharacterSchema).default({}),
  activeCharacterId: z.string().nullable().default(null),
  // the game time since the campaign began, in seconds
  clock: z.number().default(0),
  // survival.tex "Exposure": how rough the ground the party is on is
  exposure: z.number().default(0),
  // the plans for the coming ET, emptied when it passes
  plans: z.record(z.string(), ETPlanSchema).default({}),
  // the rests that have healed each character today, emptied at the day's end
  rests: z.record(z.string(), z.number()).default({}),
  // the Will tests the last ET opened with, replaced when the next passes
  exhaustionRolls: z.record(z.string(), ExhaustionRollSchema).default({}),
})

export type CampaignState = z.infer<typeof CampaignStateSchema>

export type CampaignUpdater = (state: CampaignState) => CampaignState

// The campaign and the fight run beside it. A character is in one or the
// other, never both: a fight takes its characters off the roster and gives
// them back when it is over.
export type Table = { campaign: CampaignState; fight: CombatState }

export type TableUpdater = (table: Table) => Table
