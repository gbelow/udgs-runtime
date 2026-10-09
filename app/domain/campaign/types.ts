import { z } from 'zod'
import { CampaignCharacterSchema, DegreeSchema } from '../types'
import { ROLL_MODES } from '../combat/dice'
import type { CombatState } from '../combat/types'

// survival.tex "Exploration Action (EA)", "Making camp": what a group of a
// party goes on together for an ET. Travel and search take it away from the
// party; the four camp tasks are the Prepare action.
export const GROUP_KINDS = ['travel', 'search', 'shelter', 'firewood', 'fire', 'cook'] as const
export const GroupKindSchema = z.enum(GROUP_KINDS)
export type GroupKind = z.infer<typeof GroupKindSchema>

// "only one character rolls for it": the roller is one of the members. The
// table enters the DL and, for travel and search, the roller's knowledge of
// the place; `tool` is an item or spell that lights the fire without a test.
export const GroupSchema = z.object({
  kind: GroupKindSchema,
  members: z.array(z.string()).default([]),
  roller: z.string().nullable().default(null),
  DL: z.number().default(0),
  mode: z.enum(ROLL_MODES).default('normal'),
  knowledge: z.number().default(0),
  tool: z.boolean().default(false),
})
export type Group = z.infer<typeof GroupSchema>

// survival.tex "Night and Darkness": daylight, night with a light source or
// sight in the dark, or night without vision.
export const LIGHTS = ['day', 'lit', 'dark'] as const
export const LightSchema = z.enum(LIGHTS)
export type Light = z.infer<typeof LightSchema>

// survival.tex "Making camp": what has been set up where the party is. A
// graze on firewood or the fire leaves `progress`, which a group of the same
// task finishes the ET after.
export const CampSchema = z.object({
  shelter: z.number().default(0),
  firewood: z.number().default(0),
  fire: z.boolean().default(false),
  progress: z.array(z.enum(['firewood', 'fire'])).default([]),
})
export type Camp = z.infer<typeof CampSchema>

// Whoever is in the same place. Members choose what they do; a group that
// travels leaves as a party of its own.
export const PartySchema = z.object({
  name: z.string().default(''),
  // survival.tex "Exposure": how rough the ground the party is on is
  exposure: z.number().default(0),
  light: LightSchema.default('day'),
  camp: CampSchema.default(CampSchema.parse({})),
  groups: z.record(z.string(), GroupSchema).default({}),
})
export type Party = z.infer<typeof PartySchema>

// A test made between ETs: an exhaustion Will test, or a group's.
export const TestRollSchema = z.object({
  die: z.number(),
  score: z.number(),
  DL: z.number(),
  degree: DegreeSchema,
})
export type TestRoll = z.infer<typeof TestRollSchema>

// What happens to a character forced to rest while their group goes away:
// left behind to rest, the group staying with them instead of going, or
// carried along, resting on the way.
export const DECISIONS = ['leave', 'stay', 'carry'] as const
export const DecisionSchema = z.enum(DECISIONS)
export type Decision = z.infer<typeof DecisionSchema>

// The coming ET once its Will tests are rolled, waiting on the decisions
// they call for.
export const OpeningSchema = z.object({
  rolls: z.record(z.string(), TestRollSchema).default({}),
  decisions: z.record(z.string(), DecisionSchema).default({}),
})
export type Opening = z.infer<typeof OpeningSchema>

// What a group's ET came to, as the table reads it afterwards. `roll` is
// null where no test was made: a task finished from progress, a fire lit by
// a tool, or nothing to light.
export const GroupResultSchema = z.object({
  party: z.string(),
  kind: GroupKindSchema,
  members: z.array(z.string()),
  roll: TestRollSchema.nullable(),
  note: z.string().default(''),
})
export type GroupResult = z.infer<typeof GroupResultSchema>

// The campaign above every scene: the roster of everyone in play who is not
// in a fight, the parties they are in, and the clock all of them share.
export const CampaignStateSchema = z.object({
  characters: z.record(z.string(), CampaignCharacterSchema).default({}),
  activeCharacterId: z.string().nullable().default(null),
  // the game time since the campaign began, in seconds
  clock: z.number().default(0),
  parties: z.record(z.string(), PartySchema).default({}),
  // the party each character is in, kept while they are in a fight
  partyOf: z.record(z.string(), z.string()).default({}),
  // who rests the coming ET outside any group; the rest are idle
  resting: z.array(z.string()).default([]),
  // who was sent to a fight this ET and sits out what they planned
  out: z.array(z.string()).default([]),
  // the rests that have healed each character today, emptied at the day's end
  rests: z.record(z.string(), z.number()).default({}),
  opening: OpeningSchema.nullable().default(null),
  // what the last ET opened with and what its groups came to
  exhaustionRolls: z.record(z.string(), TestRollSchema).default({}),
  results: z.array(GroupResultSchema).default([]),
})

export type CampaignState = z.infer<typeof CampaignStateSchema>

export type CampaignUpdater = (state: CampaignState) => CampaignState

// The campaign and the fight run beside it. A character is in one or the
// other, never both: a fight takes its characters off the roster and gives
// them back when it is over.
export type Table = { campaign: CampaignState; fight: CombatState }

export type TableUpdater = (table: Table) => Table
