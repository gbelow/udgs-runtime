import { z } from 'zod'
import { DegreeSchema, ItemSchema } from '../types'
import { ROLL_MODES } from '../play/dice'
import { TestRollSchema, type TestRoll } from '../play/test'
import { CallsSchema } from '../play/calls'
import { AtSchema, EventOutcomeSchema, EventTypeSchema, PlaceChangeSchema, type CampaignState } from '../campaign/types'

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
  // the shelter event of its node the camp stands in, by id; none in the open
  in: z.string().nullable().default(null),
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

// The ET under way once its Will tests are rolled: the decisions they call
// for, and the camp each party started it with, which its tasks are read
// against while it changes plan by plan.
export const OpeningSchema = z.object({
  rolls: z.record(z.string(), TestRollSchema).default({}),
  decisions: z.record(z.string(), DecisionSchema).default({}),
  start: z.record(z.string(), CampSchema).default({}),
})
export type Opening = z.infer<typeof OpeningSchema>

// survival.tex "Events": an event a group met, where it is, the DL it was
// read against, the degree the group's score came to and the outcome for
// it; the table's change to the DL of the test it asks (a rope thrown down
// the climb), and each member's test of it once made.
export const MetSchema = z.object({
  owner: z.object({ kind: z.enum(['node', 'connection']), id: z.string() }),
  event: z.string(),
  name: z.string(),
  DL: z.number(),
  degree: DegreeSchema,
  outcome: EventOutcomeSchema,
  adjust: z.number().default(0),
  tests: z.array(z.object({ name: z.string(), roll: TestRollSchema, text: z.string() })).default([]),
})
export type Met = z.infer<typeof MetSchema>

// What a group's travel or search came to before what it met lands: its
// roll, where it ends the ET (null off the map, no `moves` where it
// started) and the events met. Kept while the table looks at what was met,
// so the draws stand.
export const MeetingSchema = z.object({
  roll: TestRollSchema.nullable(),
  note: z.string().default(''),
  moves: z.object({ at: AtSchema.nullable() }).nullable().default(null),
  events: z.array(MetSchema).default([]),
})
export type Meeting = z.infer<typeof MeetingSchema>

// What a group's ET came to, as the table reads it afterwards. `roll` is
// null where no test was made: a task finished from progress, a fire lit by
// a tool, or nothing to light.
export const GroupResultSchema = z.object({
  party: z.string(),
  kind: GroupKindSchema,
  members: z.array(z.string()),
  roll: TestRollSchema.nullable(),
  note: z.string().default(''),
  events: z.array(MetSchema).default([]),
})
export type GroupResult = z.infer<typeof GroupResultSchema>

// A group's plan once resolved: what it came to, who spent the ET on it, and
// the items it put on the party's pile. What takes the whole ET finishes only
// when the ET closes, everyone at once, so that an ET cut short leaves it
// undone: where the group ends up, taking what it found, and the degree a
// camp task lands on the camp at.
export const ResolvedSchema = z.object({
  result: GroupResultSchema.nullable(),
  working: z.array(z.string()).default([]),
  moves: z.object({ at: AtSchema.nullable(), ids: z.array(z.string()) }).nullable().default(null),
  found: z.array(z.string()).default([]),
  task: z.object({ kind: GroupKindSchema, degree: DegreeSchema }).nullable().default(null),
})
export type Resolved = z.infer<typeof ResolvedSchema>

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

// Who of a party spent the ET in camp outside any group or cast: resting,
// or idle (survival.tex "Exhaustion": every ET but a rest adds +1 exhaustion).
export const StayResultSchema = z.object({
  party: z.string(),
  rested: z.array(z.string()).default([]),
  idle: z.array(z.string()).default([]),
})
export type StayResult = z.infer<typeof StayResultSchema>

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
  // the plans of the ET under way resolved so far, by party and group; their
  // members make no other plan until the ET closes
  resolved: z.record(z.string(), z.record(z.string(), ResolvedSchema)).default({}),
  // the plan being resolved whose events met ask a test, held for the table
  // to change its DL before the test is called
  pending: z.object({ party: z.string(), group: z.string(), meeting: MeetingSchema }).nullable().default(null),
  // the plan whose dice the table is throwing; null while they are the ET's
  // passing
  running: z.object({ party: z.string(), group: z.string() }).nullable().default(null),
  // survival.tex "Events": what each party has found, to share out
  piles: z.record(z.string(), z.array(ItemSchema)).default({}),
  // the weather the table calls on a node, by place key, until it changes it
  weather: z.record(z.string(), PlaceChangeSchema).default({}),
  // the weather events brought on a node, by place key, for the ET under way
  passing: z.record(z.string(), z.array(PlaceChangeSchema)).default({}),
  // the events each character has met, by event key: the table's ruling is
  // that one met before is found at DL -5
  known: z.record(z.string(), z.array(z.string())).default({}),
  // the tests the passing ET has called for, waiting on their dice
  calls: CallsSchema.default({}),
  // what the last ET opened with and what its groups came to
  exhaustionRolls: z.record(z.string(), TestRollSchema).default({}),
  results: z.array(GroupResultSchema).default([]),
  castResults: z.array(CastResultSchema).default([]),
  stayResults: z.array(StayResultSchema).default([]),
})
export type ExplorationState = z.infer<typeof ExplorationStateSchema>

// Exploration runs on the whole roster at once: it reads and moves the
// campaign (characters, clock, parties) beside its own state.
export type Exploring = { campaign: CampaignState; exploration: ExplorationState }

export type ExplorationUpdater = (t: Exploring) => Exploring
