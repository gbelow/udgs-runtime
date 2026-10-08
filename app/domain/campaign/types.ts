import { z } from 'zod'
import { CampaignCharacterSchema } from '../types'
import type { CombatState } from '../combat/types'

// The campaign above every scene: the roster of everyone in play who is not
// in a fight, and the clock all of them share.
export const CampaignStateSchema = z.object({
  characters: z.record(z.string(), CampaignCharacterSchema).default({}),
  activeCharacterId: z.string().nullable().default(null),
  // the game time since the campaign began, in seconds
  clock: z.number().default(0),
})

export type CampaignState = z.infer<typeof CampaignStateSchema>

export type CampaignUpdater = (state: CampaignState) => CampaignState

// The campaign and the fight run beside it. A character is in one or the
// other, never both: a fight takes its characters off the roster and gives
// them back when it is over.
export type Table = { campaign: CampaignState; fight: CombatState }

export type TableUpdater = (table: Table) => Table
