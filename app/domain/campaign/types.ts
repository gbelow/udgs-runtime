import { z } from 'zod'
import { CampaignCharacterSchema, CostSchema, ItemSchema, LearningTestSchema, SkillKeySchema, type Selected } from '../types'

// survival.tex "Events": the 8 types of events.
export const EVENT_TYPES = ['place', 'encounter', 'obstacle', 'treasure', 'wear', 'food', 'shelter', 'water'] as const
export const EventTypeSchema = z.enum(EVENT_TYPES)
export type EventType = z.infer<typeof EventTypeSchema>

// survival.tex "Terrain tags", and wind, which the book does not list: it
// is what the events that blow it and shelter from it say it is.
export const TERRAIN_TAGS = ['wood', 'rain', 'wind', 'cold', 'heat', 'insects', 'threats'] as const
export const TerrainTagSchema = z.enum(TERRAIN_TAGS)
export type TerrainTag = z.infer<typeof TerrainTagSchema>

// survival.tex "Wear": what an exploration action costs on top of the usual,
// from the terrain ("spending an ET in the desert without shelter always
// inflicts an extra thirst") or from an event met: a cost, paid as the
// character pays any.
export const WearSchema = CostSchema.pick({ IL: true, exhaustion: true }).extend({ hunger: z.number().default(0), thirst: z.number().default(0) })
export type Wear = z.infer<typeof WearSchema>

// What changes a place for a while — weather an event brings or the table
// calls, or a shelter: its exposure set to a value, or raised, and terrain
// tags added or taken away.
export const PlaceChangeSchema = z.object({
  exposure: z.number().nullable().default(null),
  raise: z.number().default(0),
  add: z.array(TerrainTagSchema).default([]),
  remove: z.array(TerrainTagSchema).default([]),
})
export type PlaceChange = z.infer<typeof PlaceChangeSchema>

const perDegree = <T extends z.ZodType>(outcome: T) =>
  z.object({ critical: outcome, hit: outcome, graze: outcome, miss: outcome })

// What lands on one who made an event's test, by their degree.
export const EventResultSchema = z.object({
  text: z.string().default(''),
  wear: WearSchema.prefault({}),
})
export type EventResult = z.infer<typeof EventResultSchema>

// survival.tex "Events": "Everyone must make a DL 3 climbing test" — a test
// each one present makes, its DL lowered or raised by the table as what
// they do calls for.
export const EventTestSchema = z.object({
  skill: SkillKeySchema.default('climb'),
  DL: z.number().default(0),
  results: perDegree(EventResultSchema.prefault({})).prefault({}),
})
export type EventTest = z.infer<typeof EventTestSchema>

// What an event comes to at one degree: what the table reads, the wear it
// costs everyone present, what is found, the test it asks of each of them,
// and, on a path, whether it keeps the group from arriving. `takesET` is the
// event's word on whether it takes the whole ET (survival.tex "Event DL").
// `weather` is what it does to the place the party stands on, for the ET.
// `scene` is a prepared scene it leads to, played out before the ET passes;
// `learning` a learning test each of them makes (story.tex "Learning tests":
// "climbing a tall tree to see the surrounding area").
export const EventOutcomeSchema = z.object({
  text: z.string().default(''),
  takesET: z.boolean().default(true),
  stop: z.boolean().default(false),
  wear: WearSchema.prefault({}),
  items: z.array(z.object({ key: z.string(), amount: z.number().default(1) })).default([]),
  test: EventTestSchema.nullable().default(null),
  weather: PlaceChangeSchema.nullable().default(null),
  scene: z.object({ preset: z.string(), forced: z.boolean().default(true) }).nullable().default(null),
  learning: LearningTestSchema.nullable().default(null),
})
export type EventOutcome = z.infer<typeof EventOutcomeSchema>

// A scene prepared in the catalog for an event to lead to: what the table
// reads, the battle map it is played on (a shared one, by name; none for a
// scene with no board), the catalog characters it is played against, so many
// of each, and the treasure lying there, from the item catalog.
export const ScenePresetSchema = z.object({
  name: z.string().default(''),
  text: z.string().default(''),
  board: z.string().default(''),
  opponents: z.array(z.object({ key: z.string().default(''), count: z.number().default(1) })).default([]),
  treasure: z.array(z.object({ key: z.string().default(''), amount: z.number().default(1) })).default([]),
})
export type ScenePreset = z.infer<typeof ScenePresetSchema>

// survival.tex "Wear": an event that "can have a chance to happen regardless
// of the exploration test result" — rain, a storm. It is met by no
// exploration test: each ET it happens on the whole node by its chance in
// 100, or when the table sets it off, brings its weather on it for the ET,
// and costs everyone there its wear and what the test it asks comes to.
export const AmbientSchema = z.object({
  chance: z.number().default(0),
  text: z.string().default(''),
  weather: PlaceChangeSchema.prefault({}),
  wear: WearSchema.prefault({}),
  test: EventTestSchema.nullable().default(null),
})
export type Ambient = z.infer<typeof AmbientSchema>

// survival.tex "Events": what an event is, as the events catalog keeps it
// outside any map, for events on any map to be made of: its name and what
// the table reads of it, the DL the exploration test finds it against, the
// types it is searched for by, and what it comes to at each degree. A
// shelter ("finds a place with better exposure than the rest of the node")
// says what the place is like to a party that camps in it; an ambient event
// is met by no test, so its DL, types and outcomes are not read. What its
// outcomes find is taken off it once found, unless it `renews` (a spring, a
// tree that fruits again).
export const EventTemplateSchema = z.object({
  name: z.string().default(''),
  text: z.string().default(''),
  types: z.array(EventTypeSchema).default([]),
  DL: z.number().default(0),
  outcomes: perDegree(EventOutcomeSchema.prefault({})).prefault({}),
  shelter: PlaceChangeSchema.nullable().default(null),
  ambient: AmbientSchema.nullable().default(null),
  renews: z.boolean().default(false),
})
export type EventTemplate = z.infer<typeof EventTemplateSchema>

// survival.tex "Events": something on a node or a connection, found on
// purpose against its DL. Each event resolves itself, by the outcome for the
// degree the test came to; play and the GM change it as it goes (the tree
// stripped, the deer butchered). It is made of a template from the catalog,
// by key, and keeps only what it changes of it — or, with none, is all its
// own.
export const CrawlEventSchema = z.object({
  template: z.string().nullable().default(null),
  custom: EventTemplateSchema.partial().default({}),
})
export type CrawlEvent = z.infer<typeof CrawlEventSchema>

// survival.tex "Terrain": a preset a node is made of, kept in the terrain
// catalog outside any map. `knowledge` is the one location knowledge is read
// from.
export const TerrainSchema = z.object({
  name: z.string().default(''),
  exposure: z.number().default(0),
  shelterDL: z.number().default(0),
  wear: WearSchema.prefault({}),
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
  // where the node is drawn; none until it is put somewhere
  x: z.number().nullable().default(null),
  y: z.number().nullable().default(null),
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
// The sequence of play that moves a party's time (play.tex "The four game
// loops"): ETs while it explores, days while it is in downtime. A party
// leaves one for the other as a whole.
export const SEQUENCES = ['exploration', 'downtime'] as const
export type Sequence = (typeof SEQUENCES)[number]

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
  // running: only an active party on a timeline feels time pass; frozen otherwise
  active: z.boolean().default(false),
  // the sequence it is in while running on a timeline; kept while it is
  // frozen or outside time, when it is in none
  sequence: z.enum(SEQUENCES).default('downtime'),
})
export type Party = z.infer<typeof PartySchema>

// The catalogs a collection lists entries of.
export const CATALOG_KINDS = ['characters', 'races', 'maps', 'abilities', 'spells', 'weapons', 'armors', 'ammo', 'items', 'containers', 'terrains', 'events', 'scenes', 'knowledges'] as const
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
  // the profile that wrote a note, which may change it; null for what play
  // recorded, or a note from before notes kept who wrote them
  author: z.string().nullable().default(null),
})
export type CampaignEntry = z.infer<typeof CampaignEntrySchema>

// A prepared scene an event met led to, waiting to be played out or, offered
// rather than forced, passed by: by the members of the party who met it, at
// the place they met it.
export const WaitingSceneSchema = z.object({
  preset: z.string(),
  party: z.string(),
  members: z.array(z.string()).default([]),
  forced: z.boolean().default(true),
  event: z.string().default(''),
  at: AtSchema.nullable().default(null),
})
export type WaitingScene = z.infer<typeof WaitingSceneSchema>

// The campaign above every scene: the roster of everyone in play who is not
// in a fight, and the parties they are in, where, and when, each party on a
// timeline of its own. What a mode keeps for itself (exploration's plans and
// camps, the fight's log) is not here.
export const CampaignStateSchema = z.object({
  characters: z.record(z.string(), CampaignCharacterSchema).default({}),
  // survival.tex "Night and Darkness": "The standard is 4 periods of day and
  // 2 of night"; the ETs of a day that are daylight, night being the rest
  dayETs: z.number().default(4),
  // gear.tex "Equipment Breakage": "The equipment breakage function is
  // optional" — whether blows put the objects they meet at risk; a fight
  // takes it from here as its characters join
  breakage: z.boolean().default(true),
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
  // the ids the campaign has lent to a fight, sent from the roster or brought
  // straight in, until they come back or are gone: every id at the table is
  // the campaign's to give
  lent: z.array(z.string()).default([]),
  // the prepared scenes events led to, by id, until they are played or
  // passed by; nobody's ET passes while one of its party's waits
  scenes: z.record(z.string(), WaitingSceneSchema).default({}),
  // what a scene left lying where it was played, by place key, for whoever
  // stands there to take
  left: z.record(z.string(), z.array(ItemSchema)).default({}),
})

export type CampaignState = z.infer<typeof CampaignStateSchema>

// The campaign as one screen sees it, with whom it has picked.
export type SeenCampaign = CampaignState & Selected

export type CampaignUpdater = (state: CampaignState) => CampaignState

// Where a character comes back to from a fight: a party of the campaign's, or
// one the fight made, which joins the campaign where `from` is. Either is
// called `name` from then on.
export type Homecoming = { partyId: string; name: string; from?: Party }

// What a campaign keeps of itself when it is saved: everything but its
// characters, which are saved apart and named by id.
export const CampaignRecordSchema = CampaignStateSchema.omit({ characters: true })
export type CampaignRecord = z.infer<typeof CampaignRecordSchema>
