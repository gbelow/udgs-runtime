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

// survival.tex "Events": the 8 types of events.
export const EVENT_TYPES = ['place', 'encounter', 'obstacle', 'treasure', 'wear', 'food', 'shelter', 'water'] as const
export const EventTypeSchema = z.enum(EVENT_TYPES)
export type EventType = z.infer<typeof EventTypeSchema>

// survival.tex "Terrain tags".
export const TERRAIN_TAGS = ['wood', 'rain', 'cold', 'heat', 'insects', 'threats'] as const
export const TerrainTagSchema = z.enum(TERRAIN_TAGS)
export type TerrainTag = z.infer<typeof TerrainTagSchema>

// survival.tex "Events": something on a node or a connection, found on purpose
// against its DL. Each event resolves itself: the table reads the outcome for
// the degree the test came to against it. "Knowledge enablers": the knowledge
// level it needs from someone present.
export const CrawlEventSchema = z.object({
  name: z.string().default(''),
  types: z.array(EventTypeSchema).default([]),
  DL: z.number().default(0),
  enabler: z.object({ knowledge: z.string(), level: z.number() }).nullable().default(null),
  outcomes: z.object({
    critical: z.string().default(''),
    hit: z.string().default(''),
    graze: z.string().default(''),
    miss: z.string().default(''),
  }).default({ critical: '', hit: '', graze: '', miss: '' }),
})
export type CrawlEvent = z.infer<typeof CrawlEventSchema>

// survival.tex "Terrain": what a node is made of. `knowledge` is the one
// location knowledge is read from; `wear` is extra IL for every EA in it.
export const TerrainSchema = z.object({
  name: z.string().default(''),
  exposure: z.number().default(0),
  shelterDL: z.number().default(0),
  wear: z.number().default(0),
  knowledge: z.string().default('survival'),
  tags: z.array(TerrainTagSchema).default([]),
})
export type Terrain = z.infer<typeof TerrainSchema>

export const CrawlNodeSchema = z.object({
  name: z.string().default(''),
  terrain: z.string().nullable().default(null),
  events: z.record(z.string(), CrawlEventSchema).default({}),
})
export type CrawlNode = z.infer<typeof CrawlNodeSchema>

// survival.tex "Creating the point crawl": a path between two nodes, both
// ways, with the DL of travelling it and the events met on the way.
export const ConnectionSchema = z.object({
  a: z.string(),
  b: z.string(),
  DL: z.number().default(0),
  events: z.record(z.string(), CrawlEventSchema).default({}),
})
export type Connection = z.infer<typeof ConnectionSchema>

export const CrawlMapSchema = z.object({
  name: z.string().default(''),
  terrains: z.record(z.string(), TerrainSchema).default({}),
  nodes: z.record(z.string(), CrawlNodeSchema).default({}),
  connections: z.record(z.string(), ConnectionSchema).default({}),
})
export type CrawlMap = z.infer<typeof CrawlMapSchema>

export type MapUpdater = (map: CrawlMap) => CrawlMap

// Where an event is: on a node or on a connection.
export type EventOwner = { kind: 'node' | 'connection'; id: string }

// "only one character rolls for it": the roller is one of the members. The
// table enters the DL where the map gives none; `target` is the connection a
// travel goes along, `seek` the type of event a search looks for, `tool` an
// item or spell that lights the fire without a test.
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
  // the node of the map the party is on, or none, off the map
  node: z.string().nullable().default(null),
  // survival.tex "Exposure": how rough the ground is, entered off the map
  exposure: z.number().default(0),
  // survival.tex "Night and Darkness": a light source or sight in the dark
  lit: z.boolean().default(false),
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
  // the events met, with the outcome for the degree reached against each
  events: z.array(z.object({ name: z.string(), DL: z.number(), degree: DegreeSchema, outcome: z.string() })).default([]),
})
export type GroupResult = z.infer<typeof GroupResultSchema>

// The campaign above every scene: the roster of everyone in play who is not
// in a fight, the parties they are in, and the clock all of them share.
export const CampaignStateSchema = z.object({
  characters: z.record(z.string(), CampaignCharacterSchema).default({}),
  activeCharacterId: z.string().nullable().default(null),
  // the game time since the campaign began, in seconds
  clock: z.number().default(0),
  // survival.tex "Night and Darkness": "The standard is 4 periods of day and
  // 2 of night"; the ETs of a day that are daylight, night being the rest
  dayETs: z.number().default(4),
  // the point crawl the parties are on, if any
  map: CrawlMapSchema.nullable().default(null),
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
