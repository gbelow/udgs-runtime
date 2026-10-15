import { z } from 'zod'
import { CampaignCharacterSchema } from '../types'

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

// survival.tex "Terrain": "Terrain can have value for extra wear. For
// example, spending an ET in the desert without shelter always inflicts an
// extra thirst" — what every EA in it costs on top of the usual wear.
export const TerrainWearSchema = z.object({
  IL: z.number().default(0),
  exhaustion: z.number().default(0),
  hunger: z.number().default(0),
  thirst: z.number().default(0),
})
export type TerrainWear = z.infer<typeof TerrainWearSchema>

// survival.tex "Terrain": a preset a node is made of, kept in the terrain
// catalog outside any map. `knowledge` is the one location knowledge is read
// from.
export const TerrainSchema = z.object({
  name: z.string().default(''),
  exposure: z.number().default(0),
  shelterDL: z.number().default(0),
  wear: TerrainWearSchema.default({ IL: 0, exhaustion: 0, hunger: 0, thirst: 0 }),
  knowledge: z.string().default('survival'),
  tags: z.array(TerrainTagSchema).default([]),
})
export type Terrain = z.infer<typeof TerrainSchema>

// What a node may change of its terrain. Nothing defaults: a value missing
// is one the node takes from its terrain.
export const TerrainValuesSchema = z.object({
  exposure: z.number(),
  shelterDL: z.number(),
  wear: z.object({ IL: z.number(), exhaustion: z.number(), hunger: z.number(), thirst: z.number() }),
  knowledge: z.string(),
  tags: z.array(TerrainTagSchema),
})
export type TerrainValues = z.infer<typeof TerrainValuesSchema>

// story.tex "Downtime": a town downtime can be spent in. "The cost of living
// changes from town to town": `living` scales the average the book gives.
export const SettlementSchema = z.object({
  living: z.number().default(1),
})
export type Settlement = z.infer<typeof SettlementSchema>

// A node is made of a terrain from the catalog, by name, and keeps only what
// it changes of it.
export const CrawlNodeSchema = z.object({
  name: z.string().default(''),
  terrain: z.string().nullable().default(null),
  settlement: SettlementSchema.nullable().default(null),
  custom: TerrainValuesSchema.partial().default({}),
  events: z.record(z.string(), CrawlEventSchema).default({}),
})
export type CrawlNode = z.infer<typeof CrawlNodeSchema>

// Which way along a path an event happens: both ways, from `a` to `b`
// (there) or from `b` to `a` (back).
export const WAYS = ['both', 'there', 'back'] as const
export const WaySchema = z.enum(WAYS)
export type Way = z.infer<typeof WaySchema>

export const PathEventSchema = CrawlEventSchema.extend({ way: WaySchema.default('both') })
export type PathEvent = z.infer<typeof PathEventSchema>

// survival.tex "Creating the point crawl": a path between two nodes, with the
// DL of travelling it each way and the events met on the way.
export const ConnectionSchema = z.object({
  a: z.string(),
  b: z.string(),
  DL: z.number().default(0),
  backDL: z.number().default(0),
  events: z.record(z.string(), PathEventSchema).default({}),
})
export type Connection = z.infer<typeof ConnectionSchema>

export const CrawlMapSchema = z.object({
  name: z.string().default(''),
  nodes: z.record(z.string(), CrawlNodeSchema).default({}),
  connections: z.record(z.string(), ConnectionSchema).default({}),
})
export type CrawlMap = z.infer<typeof CrawlMapSchema>

export type MapUpdater = (map: CrawlMap) => CrawlMap

// Where an event is: on a node or on a connection.
export type EventOwner = { kind: 'node' | 'connection'; id: string }

// A node of one of the campaign's maps.
export const AtSchema = z.object({ map: z.string(), node: z.string() })
export type At = z.infer<typeof AtSchema>

// Whoever is in the same place, and where that is.
export const PartySchema = z.object({
  name: z.string().default(''),
  // the node the party is on, or none, off the map
  at: AtSchema.nullable().default(null),
  // survival.tex "Exposure": how rough the ground is, entered off the map
  exposure: z.number().default(0),
  // survival.tex "Night and Darkness": a light source or sight in the dark
  lit: z.boolean().default(false),
  // the ETs since the campaign began on this party's own timeline; none for
  // a party outside time, such as an encounter, until it is placed on one
  clock: z.number().nullable().default(null),
  // in play: only an active party on a timeline feels time pass
  active: z.boolean().default(false),
})
export type Party = z.infer<typeof PartySchema>

// The catalogs a collection lists entries of.
export const CATALOG_KINDS = ['characters', 'races', 'maps', 'abilities', 'spells', 'weapons', 'armors', 'ammo', 'items', 'containers', 'terrains', 'knowledges'] as const
export const CatalogKindSchema = z.enum(CATALOG_KINDS)
export type CatalogKind = z.infer<typeof CatalogKindSchema>

// A list a GM curates of one catalog's entries, each by the key the catalog
// files it under. It is its owner's, and read by whoever it is shared with:
// profiles by id, and every member of a campaign by the campaign's id.
export const CollectionSchema = z.object({
  id: z.string(),
  owner: z.string(),
  kind: CatalogKindSchema,
  name: z.string().default(''),
  keys: z.array(z.string()).default([]),
  shared: z.object({
    profiles: z.array(z.string()).default([]),
    campaigns: z.array(z.string()).default([]),
  }).default({ profiles: [], campaigns: [] }),
})
export type Collection = z.infer<typeof CollectionSchema>

// What an entry of the journal is: a note written by hand, or what play
// recorded — an ET, days of downtime, a scene come back from, a fight's log,
// a party synced to another timeline.
export const EntryKindSchema = z.enum(['note', 'et', 'days', 'scene', 'fight', 'sync'])
export type EntryKind = z.infer<typeof EntryKindSchema>

// One entry of the campaign's journal: what happened, or what the GM wrote,
// to a party at a moment of its timeline (none for the campaign as a whole,
// or a party outside time). The party's name is kept as it was then.
export const CampaignEntrySchema = z.object({
  id: z.string(),
  kind: EntryKindSchema.default('note'),
  party: z.string().nullable().default(null),
  partyName: z.string().default(''),
  clock: z.number().nullable().default(null),
  title: z.string().default(''),
  lines: z.array(z.string()).default([]),
  // a note the players do not see
  gmOnly: z.boolean().default(false),
})
export type CampaignEntry = z.infer<typeof CampaignEntrySchema>

// The campaign above every scene: the roster of everyone in play who is not
// in a fight, and the parties they are in, where, and when, each party on a
// timeline of its own. What a mode keeps for itself (exploration's plans and
// camps, the fight's log) is not here.
export const CampaignStateSchema = z.object({
  characters: z.record(z.string(), CampaignCharacterSchema).default({}),
  activeCharacterId: z.string().nullable().default(null),
  // survival.tex "Night and Darkness": "The standard is 4 periods of day and
  // 2 of night"; the ETs of a day that are daylight, night being the rest
  dayETs: z.number().default(4),
  // the point crawls the parties play on, by id: the campaign's own copies
  // of maps from the catalog, so what play changes on one stays here
  maps: z.record(z.string(), CrawlMapSchema).default({}),
  // what happened and what the GM wrote, in the order it was written
  journal: z.array(CampaignEntrySchema).default([]),
  parties: z.record(z.string(), PartySchema).default({}),
  // the party each character is in, kept while they are in a fight
  partyOf: z.record(z.string(), z.string()).default({}),
  // the name each character in a party on a timeline goes by, which tells
  // copies of one sheet apart; kept while they are in a fight
  names: z.record(z.string(), z.string()).default({}),
  // who was sent to a fight this ET and sits out what they planned
  out: z.array(z.string()).default([]),
})

export type CampaignState = z.infer<typeof CampaignStateSchema>

export type CampaignUpdater = (state: CampaignState) => CampaignState

// Where a character comes back to from a fight: a party of the campaign's, or
// one the fight made, which joins the campaign where `from` is. Either is
// called `name` from then on.
export type Homecoming = { partyId: string; name: string; from?: Party }

// What a campaign keeps of itself when it is saved: everything but its
// characters, which are saved apart and named by id, and who is picked.
export const CampaignRecordSchema = CampaignStateSchema.omit({ characters: true, activeCharacterId: true })
export type CampaignRecord = z.infer<typeof CampaignRecordSchema>
