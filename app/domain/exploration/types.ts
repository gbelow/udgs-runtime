import { z } from 'zod'
import { DegreeSchema } from '../types'
import { ROLL_MODES } from '../play/dice'
import { TestRollSchema, type TestRoll } from '../play/test'
import { AtSchema, EventTypeSchema, type CampaignState } from '../campaign/types'

// survival.tex "Exploration Action (EA)", "Making camp": what a group of a
// party goes on together for an ET. Travel and search take it away from the
// party; the four camp tasks are the Prepare action.
export const GROUP_KINDS = ['travel', 'search', 'shelter', 'firewood', 'fire', 'cook'] as const
export const GroupKindSchema = z.enum(GROUP_KINDS)
export type GroupKind = z.infer<typeof GroupKindSchema>

// "only one character rolls for it": the roller is one of the members. The
// table enters the DL where the map gives none; `target` is the connection a
// travel goes along, `seek` the type of event a search looks for, `tool` an
// item or spell that lights the fire without a test. A member counts only
// while they are in the group's party.
export const GroupSchema = z.object({
  kind: GroupKindSchema,
  members: z.array(z.string()).default([]),
  roller: z.string().nullable().default(null),
  DL: z.number().default(0),
  mode: z.enum(ROLL_MODES).default('normal'),
  target: z.string().nullable().default(null),
  seek: EventTypeSchema.default('food'),
  tool: z.boolean().default(false),
})
export type Group = z.infer<typeof GroupSchema>

// survival.tex "Making camp": what has been set up on the node it stands on;
// a party elsewhere has none of it. A graze on firewood or the fire leaves
// `progress`, which a group of the same task finishes the ET after.
export const CampSchema = z.object({
  at: AtSchema.nullable().default(null),
  shelter: z.number().default(0),
  firewood: z.number().default(0),
  fire: z.boolean().default(false),
  progress: z.array(z.enum(['firewood', 'fire'])).default([]),
})
export type Camp = z.infer<typeof CampSchema>

// A test made between ETs: an exhaustion Will test, or a group's.
export { TestRollSchema, type TestRoll }

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
  // the events met, with the outcome for the degree reached against each
  events: z.array(z.object({ name: z.string(), DL: z.number(), degree: DegreeSchema, outcome: z.string() })).default([]),
})
export type GroupResult = z.infer<typeof GroupResultSchema>

// spells.tex "Casting spells": a spell whose cost takes the ET, cast over it
// instead of resting or going with a group — or, the same way, an ability
// used over the ET (abilities.tex "Bone Setting"). The table names who it is
// aimed at (no more than the effect's `count`), what a heal is put on — the wound
// healed instead of the IL — the item at hand the cast uses: the food a
// charged spell goes into, the severed limb put back; the DL of a target's test the domain cannot work
// out ("poison DL"), and the improvements the overflow buys, Effortless
// first.
export const CastPlanSchema = z.object({
  key: z.string().default(''),
  targets: z.array(z.string()).default([]),
  wound: z.number().nullable().default(null),
  item: z.string().default(''),
  DL: z.number().default(0),
  enhance: z.number().default(0),
  effortless: z.boolean().default(false),
})
export type CastPlan = z.infer<typeof CastPlanSchema>

// What a cast over the ET came to: its test, and the test each target made
// against it where the spell leaves one.
export const CastResultSchema = z.object({
  party: z.string(),
  caster: z.string(),
  spell: z.string(),
  targets: z.array(z.string()).default([]),
  roll: TestRollSchema.nullable(),
  note: z.string().default(''),
  tests: z.array(z.object({ name: z.string(), roll: TestRollSchema })).default([]),
})
export type CastResult = z.infer<typeof CastResultSchema>

// What exploration keeps beside the campaign: each party's groups and camp,
// by party, and the ET loop's own bookkeeping.
export const ExplorationStateSchema = z.object({
  groups: z.record(z.string(), z.record(z.string(), GroupSchema)).default({}),
  camps: z.record(z.string(), CampSchema).default({}),
  // who rests the coming ET outside any group; the rest are idle
  resting: z.array(z.string()).default([]),
  // who casts a spell over the coming ET, by caster
  casts: z.record(z.string(), CastPlanSchema).default({}),
  // the rests that have healed each character on `day` of their party's
  // timeline; another day has none
  rests: z.record(z.string(), z.object({ day: z.number(), count: z.number() })).default({}),
  opening: OpeningSchema.nullable().default(null),
  // what the last ET opened with and what its groups came to
  exhaustionRolls: z.record(z.string(), TestRollSchema).default({}),
  results: z.array(GroupResultSchema).default([]),
  castResults: z.array(CastResultSchema).default([]),
})
export type ExplorationState = z.infer<typeof ExplorationStateSchema>

// Exploration runs on the whole roster at once: it reads and moves the
// campaign (characters, clock, parties) beside its own state.
export type Exploring = { campaign: CampaignState; exploration: ExplorationState }

export type ExplorationUpdater = (t: Exploring) => Exploring
