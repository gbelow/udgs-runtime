import { z } from 'zod'
import { AfflictionKeySchema, CampaignCharacterSchema, CoordSchema, type Coord, DegreeSchema, SensesSchema, DeliverySchema, FuelSchema, ItemSchema, SpellEffectSchema, HitLocationSchema, InterruptionSchema, MoveKindSchema, MovementKindSchema, OutcomeSchema, OutcomeStepSchema, SurgeKindSchema, VisibilitySchema } from '../types'
import { CHASE_COVERS, CHASE_MOVES, CHASE_ROLES, CHASE_TIERS, CHASE_WAYS, GRAPPLE_AFFLICTIONS, GRAPPLE_MANEUVERS, HELD_TESTS, HOP_PURCHASES, LIGHT_LEVELS, LIMIT_STRESS_ACTIONS, PUSH_MOVEMENTS } from '../lists'
import { PRESSURE_KINDS, SPELL_MODIFICATIONS } from '../tables'
import type { ACTIONS } from './rules/actionCatalog'
import { ROLL_MODES } from '../play/dice'
import { TestRollSchema } from '../play/test'
import type { CampaignState } from '../campaign/types'

export { DEGREES, DegreeSchema, HitLocationSchema, InterruptionSchema } from '../types'
export type { Degree, HitLocation, Interruption } from '../types'

const num = z.number()
const str = z.string()

// One part of a number a rule adds up, named for what it comes from.
export const TermSchema = z.object({ label: str, value: num }).strip()

// What the die came to and what it meant, with the terms the skill and the DL
// were added up from, written as it was thrown.
export const ActionRollSchema = z.object({
  die: num.default(0),
  DL: num.default(0),
  score: num.default(0), // die + skill + modifiers
  degree: DegreeSchema.default('miss'),
  HOP: num.default(0),
  skillTerms: z.array(TermSchema).default([]),
  DLTerms: z.array(TermSchema).default([]),
}).strip()
export type ActionRoll = z.infer<typeof ActionRollSchema>

// A test made once in a round whose score then stands against every DL the
// round puts to the character (combat.tex "Swimming": "The swimming test
// should not be redone more than once per round"; "Climbing": "The same test
// result is saved for the entire round"). Only the score is kept, with the
// terms it was added up from; the degree is read off it against each DL
// (`rules/heldTest.ts`).
export const HeldRollSchema = z.object({
  mode: z.enum(ROLL_MODES),
  die: z.number(),
  skill: z.number(),
  score: z.number(),
  skillTerms: z.array(TermSchema).default([]),
})
export type HeldRoll = z.infer<typeof HeldRollSchema>

// combat.tex "Stealth in combat": a detection test as it was made — the
// hider's stealth value, less what their own turn had spent where it was
// theirs, scored against the observer's detection through the sense that
// decided it.
export const DetectionTestSchema = z.object({
  score: num,
  penalty: num,
  sense: SensesSchema.keyof(),
  detection: num,
  terms: z.array(TermSchema).default([]),
  degree: DegreeSchema,
}).strip()
export type DetectionTest = z.infer<typeof DetectionTestSchema>

// Whether the observer had the hider, and the test it took; a null test is
// one decided without a roll against the stealth value.
export const DetectionSchema = z.object({
  observerId: str,
  hiderId: str,
  found: z.boolean(),
  test: DetectionTestSchema.nullable().default(null),
}).strip()
export type Detection = z.infer<typeof DetectionSchema>

// What an action produced for each character it reached, keyed by id: the
// deliveries that character's own effect processor lands.
export const DeliveriesSchema = z.record(z.string(), z.array(DeliverySchema))
export type Deliveries = z.infer<typeof DeliveriesSchema>

export const HOPPurchaseSchema = z.enum(HOP_PURCHASES)
export type HOPPurchase = z.infer<typeof HOPPurchaseSchema>

export const ActionCostSchema = z.object({
  AP: num.default(0),
  STA: num.default(0),
}).strip()

// What a landed action's damage came to on one it reached, as it was when it
// landed, with the steps of how it got there.
export const ResultSchema = z.object({ targetId: str, outcome: OutcomeSchema, steps: z.array(OutcomeStepSchema).default([]) }).strip()
export type Result = z.infer<typeof ResultSchema>

// What a phase of an action changed in the fight, found by comparing it
// before and after: a number a character carries (a resource, an injury), a
// thing a character gained or lost (a wound, an affliction, a part, a surge),
// or a thing that went from one place to another (an item, a character on the
// board).
const ChangePhase = z.enum(['roll', 'save', 'resolve', 'edit'])
export const ChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), phase: ChangePhase, id: str, what: str, from: num, to: num }).strip(),
  z.object({ kind: z.literal('gain'), phase: ChangePhase, id: str, what: z.enum(['wound', 'affliction', 'part', 'surge']), name: str, gained: z.boolean() }).strip(),
  z.object({ kind: z.literal('move'), phase: ChangePhase, id: str, what: z.enum(['item', 'character']), name: str, from: str, to: str }).strip(),
])
export type Change = z.infer<typeof ChangeSchema>

// One line of what an action costs, named for what it comes from; a price is
// the sum of its lines.
export const CostTermSchema = z.object({ label: str, AP: num.default(0), STA: num.default(0) }).strip()
export type CostTerm = z.infer<typeof CostTermSchema>

// ---------------------------------------------------------------------------
// The board

export { CoordSchema, type Coord }

// One of the six hex directions, which are also the six rotations; the
// order is `geometry.ts`'s DIRECTIONS.
export const DirectionSchema = z.literal([0, 1, 2, 3, 4, 5])
export type Direction = z.infer<typeof DirectionSchema>

// Where a character stands. `cell` is the anchor of its footprint and
// `orientation` one of the six hex rotations the footprint may take
// (creating.tex "Size and Space Occupation"); which cells that covers is the
// footprint rule's to say. `focus` is who the character is looking at, for
// line of sight (combat.tex "Visibility"); it decides nothing yet. It is a
// fact of the fight, not of the character, so it lives here and not on the
// character record.
export const PlacementSchema = z.object({
  cell: CoordSchema.default({ q: 0, r: 0 }),
  orientation: DirectionSchema.default(0),
  elevation: num.default(0), // metres; combat.tex "High Ground"
  // metres below the water's surface, 0 for a swimmer who breathes; combat.tex "Swimming"
  depth: num.default(0),
  focus: str.nullable().default(null),
  // combat.tex "Climbing": a climber part of the way up (or down) the face
  // between the cell they are in and `to`, with the metres of it they have
  // covered, the height they started at included; `elevation` is how high
  // their feet are
  climb: z.object({ to: CoordSchema, covered: num.default(0), upright: z.boolean().default(false) }).strip().nullable().default(null),
}).strip()
export type Placement = z.infer<typeof PlacementSchema>

// combat.tex "Fire", "Gas": what an area leaves on a cell for whoever stands
// in it — the burn a fire surface deals, a gas that suffocates, the
// visibility smoke leaves (null leaves the cell's own).
export const HazardSchema = z.object({
  fire: num.default(0),
  suffocating: z.boolean().default(false),
  visibility: VisibilitySchema.nullable().default(null),
}).strip()
export type Hazard = z.infer<typeof HazardSchema>

// A hazard an action left on a cell. One a sustained spell keeps names the
// caster, the spell and the explosion that cast it in `heldBy`, and goes when
// they stop holding it (spells.tex "Sustained Spells"); the rest last until they
// are put out or the fight ends (combat.tex "Fire": "A burning surface lasts
// at minimum until the end of combat, or until extinguished").
// A layer of fuel that is not burning (`fire` 0) is a coat waiting for a flame.
export const HazardLayerSchema = HazardSchema.extend({
  fuel: FuelSchema.nullable().default(null),
  heldBy: z.object({ id: str.default(''), key: str.default(''), explosionId: str.default(''), origin: CoordSchema.nullable().default(null) }).strip().nullable().default(null),
}).strip()
export type HazardLayer = z.infer<typeof HazardLayerSchema>

// combat.tex "Positioning and Visibility": what a cell does to what crosses
// it. A blocking cell is cover and, unless transparent, breaks vision
// (combat.tex "Cover"); difficult terrain asks for a Balance test (combat.tex "Balance"); the
// visibility is what the terrain grants whoever stands in it; a suffocating
// cell is gas the map was drawn with (combat.tex "Gas": "anyone that is
// inside a suffocating gas is suffocating"). What actions leave on it comes
// in `layers`.
export const TerrainCellSchema = z.object({
  blocking: z.boolean().default(false),
  transparent: z.boolean().default(false),
  // combat.tex "Damage absorption": "The absorption value is RES of the
  // target if that is an object" — what the wall in the cell absorbs; null
  // is a wall nothing breaks
  RES: num.nullable().default(null),
  difficult: z.boolean().default(false),
  liquid: z.boolean().default(false),
  // metres of water below the surface, which is the cell's elevation
  depth: num.default(0),
  elevation: num.default(0),
  // combat.tex "Fall damage": "Soft surfaces, like sand or water halve the
  // damage"; water is soft whatever this says
  soft: z.boolean().default(false),
  visibility: VisibilitySchema.default('good'),
  suffocating: z.boolean().default(false),
  // combat.tex "Balance": the DL of the difficult terrain test, "based on how
  // slippery, unstable, long, and narrow the path is" — the table's call
  DL: num.default(-5),
  // combat.tex "Climbing": the DL of climbing the face of this cell, "the quality
  // of the grips and the distance between holds"; null is a face with nothing
  // to hold, which only a climb no taller than the climber can cross
  climbDL: num.nullable().default(null),
  // combat.tex "Actions in stealth": "Hearing: Terrain noise" — what each AP
  // spent on it adds again to an ear, as a positive magnitude
  noise: num.default(0),
  // combat.tex "Darkness and light": ground with no light of its own, seen
  // only where a light source reaches it
  dark: z.boolean().default(false),
  layers: z.array(HazardLayerSchema).default([]),
}).strip()
export type TerrainCell = z.infer<typeof TerrainCellSchema>

export const LightLevelSchema = z.enum(LIGHT_LEVELS)
export type LightLevel = z.infer<typeof LightLevelSchema>

// The spatial facts of a fight, in game units. The real grid is a VTT's; this
// is what the domain needs of it to judge distance, reach, cover and where a
// move may end. `placements` is keyed by character id, `terrain` by the cell
// key `geometry.ts` makes of a Coord, and a cell absent from `terrain` is
// open ground.
export const BoardSchema = z.object({
  placements: z.record(z.string(), PlacementSchema).default({}),
  terrain: z.record(z.string(), TerrainCellSchema).default({}),
  // combat.tex "Darkness and light": the light everywhere no light source
  // reaches and no darkness is painted
  light: LightLevelSchema.default('bright'),
  // where and how far the board is drawn; the rules do not care, the
  // simulation tool does. A VTT puts the origin at its scene's centre.
  origin: CoordSchema.default({ q: 0, r: 0 }),
  radius: num.int().min(1).default(6),
}).strip()
export type Board = z.infer<typeof BoardSchema>

// ---------------------------------------------------------------------------
// Actions

// An action is data: what a character is attempting, against whom, what was
// declared before the die, and what the die said. Nothing here is a
// procedure — the character reducer reads an action and applies the part of
// it that concerns that character. It is stored, so it is a schema.
//
// `step` is where the action waits in the pipeline every action runs,
// define → react → roll → post → effect, and the commands enforce it:
// define (free to edit or cancel), react (the declaration is locked and its
// triggers loaded, so everyone else may answer it), post (the die is thrown
// and the price paid, in one step with no way back; the choices the result
// opens are made), done (the effect has landed). The roll and the effect are
// transitions, not places to wait. A reaction is at define until its root is
// rolled, and done from then.
// `cost` is written at the roll, off the actor as they were then, so the
// record says what was paid without a rule having to recompute it later.
const ActionBase = {
  id: str,
  actorId: str,
  targetId: str.nullable().default(null),
  // The action this one answers (combat.tex "Reactions"); null for an action
  // taken on the actor's own initiative.
  reactionTo: str.nullable().default(null),
  // The reaction whose resolution opened this action — an opportunity attack
  // is declared as a reaction and fought as a strike of its own.
  spawnedBy: str.nullable().default(null),
  // The landed action that left this one as a follow-up for its actor to
  // take or pass up; null for anything else.
  followUpOf: str.nullable().default(null),
  // The recipe this action was made under, by id (rules/recipes.ts): the
  // follow-up it opened, or the contested strike it was declared as; null
  // for one no recipe gave.
  recipe: str.nullable().default(null),
  // `held`: combat.tex "Concentration" — committed without the AP for it,
  // paid as far as the AP went and waiting for the round to change; in play
  // but not on the stack
  step: z.enum(['define', 'react', 'post', 'done', 'held']).default('define'),
  // combat.tex "Concentration": what an earlier round paid towards it, kept
  // from the price as it comes to be paid
  carried: ActionCostSchema.default({ AP: 0, STA: 0 }),
  // combat.tex "Concentration": committed to be held over for want of the AP
  holding: z.boolean().default(false),
  // combat.tex "Concentration": the place a held action finishes in once the
  // round has changed (by cunning, highest first); null while it is held on
  finishing: num.nullable().default(null),
  // Which part of a prepared reaction this action is, when a `prepared`
  // reaction opened it: the movement it may carry, or the action it is for.
  preparedPart: z.enum(['move', 'main']).nullable().default(null),
  // The turn this action was declared in (`SceneState.turn`), stamped when it
  // enters the log; null until then.
  turn: num.nullable().default(null),
  // the round it was declared in, stamped with the turn
  round: num.nullable().default(null),
  cost: ActionCostSchema.nullable().default(null),
  // combat.tex "Actions in stealth": what the action, as it was committed,
  // will take off its actor's stealth value (rules/stealth.ts `getNoise`)
  noise: z.object({ AP: num, heardAP: num }).strip().nullable().default(null),
  // combat.tex "Stealth in combat": as the action was committed, the
  // detection tests its actor made of its target and the ones made of its
  // actor by whoever it would have let answer it, and who of those could not
  // sense its actor at all; a detection without a test that found is not kept
  detections: z.array(DetectionSchema).default([]),
  // combat.tex "Actions in stealth": whom its actor began the turn undetected
  // by, for one committed in its actor's own turn; null for any other
  hiddenFrom: z.array(str).nullable().default(null),
  // the lines `cost` is the sum of, written with it
  costTerms: z.array(CostTermSchema).default([]),
  // combat.tex "Interruption": the AP given back to its actor as it was paid,
  // by the action it gave up
  refunded: num.default(0),
  // the surge its actor made to take the action, paid when it is declared and
  // so in no cost: the STA it took and the AP it gave
  surged: z.object({ kind: SurgeKindSchema, STA: num, AP: num }).strip().nullable().default(null),
  roll: ActionRollSchema.nullable().default(null),
  // the die each one it may deliver a test to threw with its own, by
  // character id, read when it lands (rules/tested.ts)
  targetDice: z.record(str, num).default({}),
  // the tests what it delivered left its targets, rolled as it landed
  tested: z.array(z.object({ targetId: str, name: str, roll: ActionRollSchema }).strip()).default([]),
  // what its damage came to on each it reached, written as it lands
  results: z.array(ResultSchema).default([]),
  // what its roll and its landing changed in the fight, written as they are
  // applied
  changes: z.array(ChangeSchema).default([]),
  // combat.tex "Interruption": what landed on its actor, by something it
  // gave rise to, before it landed itself, written as each lands in the
  // order they landed; `tie` marks a counterattack's strike that tied it
  interruptions: z.array(z.object({ by: str, level: z.enum(['interrupted', 'stunned']), tie: z.boolean() }).strip()).default([]),
  // combat.tex "Preparing a reaction": the reactions its actor declared to
  // what it gave rise to, by id, written as each is declared
  reactedWithin: z.array(str).default([]),
  // HOP purchase -> times bought
  spent: z.partialRecord(HOPPurchaseSchema, num).default({}),
}

// combat.tex "Crash": what one Force comparison came to. `id` is the
// target, the one moved into; `at` the path step it happened on; `diff` the
// mover's Force less the target's. The higher passes or blocks, a draw
// blocks; under 5 apart both are `stunned`, from 5 only the loser, and a
// target who loses by 5 or more falls `prone`.
export const TrampleSchema = z.object({
  id: str,
  at: num.default(0),
  diff: num.default(0),
  result: z.enum(['passed', 'blocked']),
  stunned: z.array(str).default([]),
  prone: z.boolean().default(false),
}).strip()
export type Trample = z.infer<typeof TrampleSchema>

// A weapon row is named the way the hands name it: the wielded key (an item id
// or `natural:<name>`) and the attack row's name. Empty strings are the
// declaration still to be made.
const WeaponRowRef = {
  weaponKey: str.default(''),
  attack: str.default(''),
}

// What an attack is made with: the row and the variation it is made as.
export const AttackMade = {
  ...WeaponRowRef,
  variant: str.default(''),
}

// Where an attack is aimed: the kind of place, and the target's part there
// when one was picked (combat.tex "Localized damage").
export const AttackAim = {
  location: HitLocationSchema.default('chest'),
  part: str.nullable().default(null),
}

// combat.tex "Attack against equipment": the item the target holds that a
// strike or a shot is aimed at, by id; '' aims it at the body. With no
// target character it names an item lying on the floor, or `cell` a space of
// the ground.
const ObjectAim = {
  object: str.default(''),
  cell: CoordSchema.nullable().default(null),
}

// gear.tex "Equipment Breakage": a blow met by a block or a guard strikes the
// object in the way, and the attacker's own weapon with it; one that lands
// strikes the armor worn; an attack against equipment strikes the item it is
// aimed at. The percentiles are thrown with the roll, one per
// object; `broke` is written at the resolve: the items the blow broke and
// whose they were.
// gear.tex "Equipment Breakage": the percentile thrown for the armor each
// character wears when an action's damage reaches several of them, by id,
// with the action's commit; none when the fight has no breakage.
const ArmorRolls = z.record(z.string(), num).default({})

const Breakage = {
  breakRolls: z.object({ defender: num, attacker: num, armor: num, object: num }).default({ defender: 0, attacker: 0, armor: 0, object: 0 }),
  breaks: DeliveriesSchema.default({}),
}

// combat.tex "Sweeping Attack": "Decide whether to attack from right to left
// or vice versa" — the way the arc turns from the target, declared with a
// sweeping variation by whoever strikes: a strike, or the opportunity attack
// or counterattack that opens one.
const SweepDeclaration = {
  sweepDirection: z.enum(['clockwise', 'counterclockwise']).default('clockwise'),
}

// A strike as declared before the die, whatever declares it — on a turn, as
// an opportunity attack or a counterattack, or prepared: what it is made
// with, the way a sweep turns, and what it is made as besides. combat.tex
// "Catch": a strike with a grapple row at a running target, whose hit is a
// crash the catcher gets +3 in. abilities.tex "Martial Spirit": a spiritual
// attack launched with the strike, its price added to the strike's.
export const StrikeDeclaration = {
  ...AttackMade,
  ...SweepDeclaration,
  catch: z.boolean().default(false),
  martialSpirit: z.boolean().default(false),
}

// A shot as declared before the die, whatever declares it: what it is made
// with, and gear.tex "Quiver": the stack of arrows or bolts it is loaded
// from, '' for a row that loads nothing.
export const ShotDeclaration = {
  ...AttackMade,
  ammoId: str.default(''),
}

// Two characters tied together, and which of them hold the other — a hold
// both ways is a grab answered by "grapple back". Each holder keeps the bind
// only while they maintain it with what it was made with (`anchors`, holder id
// to the wielded key or held item that serves this bind alone, the table's
// ruling). A bind is a fact of the fight, not of either character, so it
// lives on the fight; each kind says what else it carries.
const BindBaseSchema = z.object({
  members: z.tuple([str, str]),
  holders: z.array(str).default([]),
  anchors: z.record(str, str).default({}),
})

// combat.tex "Grapple": a holder keeps the hold only while they have a
// grapple row to hold with. Who a maneuver left immobile stays so while the
// grapple lasts.
export const GrappleSchema = BindBaseSchema.extend({
  kind: z.literal('grapple'),
  immobile: z.array(str).default([]),
}).strip()
export type Grapple = z.infer<typeof GrappleSchema>

// gear.tex "Net": what a thrown net ties one character to another with — the
// thrower holds it by its rope, and it lives while the net is in their hand
// (`anchors`). The tethered cannot leave `length` metres of whoever tied
// them, nor they of the tethered; either may pull the other. `dl` is what the
// tethered beats on a Prestidigitation test to slip it, the zone they were
// caught in already counted.
export const TetherSchema = BindBaseSchema.extend({
  kind: z.literal('tether'),
  length: num,
  dl: num,
}).strip()
export type Tether = z.infer<typeof TetherSchema>

// spells.tex "Sustained Lightning": the arc a held spell makes between its
// caster, who holds it, and the one target it was cast at. It lives while the
// caster holds the spell `key`; the range it was cast at, and the item it is
// fired with, are read off the caster's hold.
const SpellBindSchema = BindBaseSchema.extend({ key: str })

export const ArcSchema = SpellBindSchema.extend({
  kind: z.literal('arc'),
}).strip()
export type Arc = z.infer<typeof ArcSchema>

// spells.tex "Telepathic Link": one of the links a held linking spell makes
// between its caster and each target; it lives while the caster holds the
// spell `key`, and is broken by a will test that hits or by the target
// leaving the spell's `linkRange`.
export const LinkSchema = SpellBindSchema.extend({
  kind: z.literal('link'),
}).strip()
export type Link = z.infer<typeof LinkSchema>

export const BindSchema = z.discriminatedUnion('kind', [GrappleSchema, TetherSchema, ArcSchema, LinkSchema])
export type Bind = z.infer<typeof BindSchema>

export const GrappleAfflictionSchema = z.enum(GRAPPLE_AFFLICTIONS)
export const GrappleManeuverSchema = z.enum(GRAPPLE_MANEUVERS)
export type GrappleManeuver = z.infer<typeof GrappleManeuverSchema>

// What an action did to one grapple, written at the resolve: the pair it
// concerns, the grapple as it stands afterwards (null: it is over), what the
// maneuver did to its members beyond the grapple itself — knocked down, an
// item knocked out of a hand — and what the holds dealt
// (combat.tex "Grapple Maneuvers": "If the grapple attack has any damage, it
// deals that damage whenever a grapple maneuver is used"). `on` and `off`
// are what the change puts on and takes off each member, for the report.
export const GrappleFactsSchema = z.object({
  pair: z.tuple([str, str]),
  grapple: GrappleSchema.nullable().default(null),
  prone: z.array(str).default([]),
  dropped: z.object({ ownerId: str, itemId: str, name: str.default('') }).nullable().default(null),
  on: z.record(str, z.array(GrappleAfflictionSchema)).default({}),
  off: z.record(str, z.array(GrappleAfflictionSchema)).default({}),
  deliveries: DeliveriesSchema.default({}),
}).strip()
export type GrappleFacts = z.infer<typeof GrappleFactsSchema>

// Something lying on the ground: dropped, knocked out of a hand, or thrown
// and landed. `cell` is where; null on a fight without a board, where the
// floor is one pile.
export const FloorItemSchema = z.object({
  item: ItemSchema,
  cell: CoordSchema.nullable().default(null),
}).strip()
export type FloorItem = z.infer<typeof FloorItemSchema>

// The attacker's side of a strike or a shot, final: what the attack
// delivers to its target, written when the attack resolves, once the HOP are
// spent, with the degree the test came to. The target's reducer reads only
// this.
export const StrikeActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('strike'),
  ...StrikeDeclaration,
  ...AttackAim,
  // combat.tex "Opportunity Attack": "the defense takes -2 penalty unless
  // it's the SD"
  opportunity: z.boolean().default(false),
  ...ObjectAim,
  facts: DeliverySchema.nullable().default(null),
  ...Breakage,
  // what landing did to the target's action, written at the resolve: a move
  // an opportunity attack interrupted is cut short by it
  interruption: InterruptionSchema.default('none'),
  // combat.tex "Braced Attack": a hit "trigger[s] a trample" — the mover
  // against the bracer, written at the resolve
  trample: TrampleSchema.nullable().default(null),
  // combat.tex "Initiate the Grapple": a hit made with a grapple row may
  // grapple the target, the attacker's call once the die is known; what it
  // came to is written at the resolve
  grapples: z.boolean().default(false),
  grabbed: GrappleFactsSchema.nullable().default(null),
  // combat.tex "Evasive Jump": where the target's jump landed them, written
  // at the resolve
  jumpedTo: PlacementSchema.nullable().default(null),
  // combat.tex "Sweeping Attack": who the sweep still reaches after this
  // target, in order, written on a board when it is committed or opened;
  // and what is left of the blow when it comes to this target (combat.tex
  // "Damage absorption"), 1 for the first. Each target after the first is
  // a strike of its own, opened by the one before it, naming the sweep's
  // first strike in `sweepOf` (null on the first, and on any other strike),
  // and who the sweep met before it, the first one first, in `swept`.
  arc: z.array(str).default([]),
  sweepOf: str.nullable().default(null),
  swept: z.array(str).default([]),
  share: num.default(1),
}).strip()

// combat.tex "Accuracy", "Shoot": a ranged weapon attack, "a throw or shot
// directed at a target ... against the opponent's reflexes or their SD". The
// way of shooting (combat.tex "Shoot", "Snipe", "Quick Shot") is the
// variation, declared before the roll along with the location.
export const ShootActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('shoot'),
  ...ShotDeclaration,
  ...AttackAim,
  ...ObjectAim,
  facts: DeliverySchema.nullable().default(null),
  ...Breakage,
  // what landing did to the target's action, written at the resolve: an
  // evader "interrupted" gets no move after the shot (combat.tex "Evasion")
  interruption: InterruptionSchema.default('none'),
  // combat.tex "Throw": what left the hand, one of it, to land where the
  // throw was aimed; written at the resolve, null for a shot
  thrown: ItemSchema.nullable().default(null),
}).strip()

// combat.tex "Explosions", "Sprays"; gear.tex "Explosion": an area going
// off, aimed at ground rather than at a character — a disk at the `center`
// it goes off at, a cone from its actor pointed on the blast it goes off
// as. Nobody declares one: a throw opens it where a charge that goes off on
// impact lands, a cast with an area opens it, and so does a detonation
// (spells.tex "Detonate Explosive"). When it lands, the object a charge
// went off in is destroyed, and it generates the escapes the reflexes that
// cleared it open, and the blast.

// Where an explosion comes from decides its test: thrown, the reflex is
// against the thrower's Accuracy; cast, against what the spell's effects
// say; detonated, there is none (the table's ruling: the test was spotting
// it). `key` is the spell whose effects go off for a cast; a thrown or
// detonated one goes off with what the object `itemId` names carries,
// wherever that object is.
export const ExplosionActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('explosion'),
  source: z.enum(['thrown', 'cast', 'detonate']).default('cast'),
  key: str.default(''),
  itemId: str.default(''),
  center: CoordSchema.nullable().default(null),
  // the area effects it goes off with, written at the resolve while what
  // carried them is still there to read
  effects: z.array(SpellEffectSchema).default([]),
  // a held spray aimed again: it lays its ground and harms nobody (the
  // table's ruling)
  paintOnly: z.boolean().default(false),
  armorRolls: ArmorRolls,
}).strip()

// combat.tex "Explosions", "Sprays": the explosion going off, once everyone
// whose reflexes cleared it has moved — the follow-up an explosion
// generates as it lands. It carries the area effects as they were produced
// (`effects`), since what carried them is gone, and the spell they came
// from (`key`), if any. A disk is where the explosion was aimed; a cone is
// pointed here ("The attacker can choose the exact direction of the cone
// after the movement"). Whoever stands in the area when it resolves is in
// `facts`, each with what reaches them at their zone's degree, one delivery
// per effect that reaches them.
export const BlastActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('blast'),
  key: str.default(''),
  effects: z.array(SpellEffectSchema).default([]),
  center: CoordSchema.nullable().default(null),
  direction: DirectionSchema.nullable().default(null),
  facts: DeliveriesSchema.nullable().default(null),
  paintOnly: z.boolean().default(false),
  armorRolls: ArmorRolls,
  // combat.tex "Gas", "Fire": what it leaves on the ground, cell by cell
  paint: z.array(z.object({ cell: CoordSchema, hazard: HazardSchema })).default([]),
}).strip()

// spells.tex "Casting spells": a spell cast in the fight. The caster's test
// is against the spell's own DL, its overflow buys the spell's improvements
// (spells.tex "Spell Improvements"), and what the spell produces is written
// per character at the resolve — the caster's own effects to them, each
// target's to the target, with the test the effect leaves them on it. From
// there the caster is out of it.
export const SpellModificationSchema = z.enum(Object.keys(SPELL_MODIFICATIONS) as [keyof typeof SPELL_MODIFICATIONS, ...(keyof typeof SPELL_MODIFICATIONS)[]])

export const CastActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('cast'),
  key: str.default(''),
  // spells.tex "Quicken Spell": +3 DL to cast without the focus surge
  quicken: z.boolean().default(false),
  // spells.tex "Extend Spell": how many times the casting range is
  // extended, each +3 DL (EXTEND)
  extend: num.default(0),
  // spells.tex "Requirements": the gear at hand the spell is cast with,
  // and a charged spell charged into; empty picks the first at hand
  itemId: str.default(''),
  // the object a charged spell is charged into when that is not its gear;
  // empty picks the first at hand
  chargeItemId: str.default(''),
  // improvement -> times bought
  improved: z.partialRecord(SpellModificationSchema, num).default({}),
  // spells.tex "Casting spells": the graze was bought up to a hit for 2 AP
  grazeSaved: z.boolean().default(false),
  // the percentile die thrown with the cast for a fraction of a charge
  // (spells.tex "Amplify Spell": charges times the VM)
  chargeRoll: num.default(0),
  armorRolls: ArmorRolls,
  // a hit that did nothing, written when it lands: short of the
  // amplifications or the range its HOP had to buy
  failed: z.boolean().default(false),
  // spells.tex "Suggestion": the limit stress action suggested to the target
  suggested: z.enum(LIMIT_STRESS_ACTIONS).nullable().default(null),
  facts: DeliveriesSchema.nullable().default(null),
}).strip()

// A held spell fired again without the casting test (the table's ruling): a
// spray aimed anew from where the holder stands, a shot at the target the
// arc is bound to. Written at the commit from what is held: the item, the
// size it was cast at, the bound target, and the percentile die thrown for
// a fraction of a charge.
export const FireAgainActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('fireAgain'),
  key: str.default(''),
  itemId: str.default(''),
  size: num.default(3),
  chargeRoll: num.default(0),
  armorRolls: ArmorRolls,
  facts: DeliveriesSchema.nullable().default(null),
}).strip()

// combat.tex "Compulsions": what a spell may bind a compelled action to —
// attacking its caster, or running from them.
export const COMPULSION_CONSTRAINTS = ['attack', 'flee'] as const
export type CompulsionConstraint = (typeof COMPULSION_CONSTRAINTS)[number]

// combat.tex "Morale": what a spell whose test is a morale test (spells.tex
// "Frighten", "Offend", "Pacify", "Suggestion", "Overwhelming Terror",
// "Provocative Mockery") left its target, written when it lands: the
// afflictions it ends and leaves, the limit stress action it compels at once
// and what binds it, and whether it took back one still owed (Pacify).
export const MoraleSpellOutcomeSchema = z.object({
  cure: z.array(AfflictionKeySchema).default([]),
  inflict: z.array(AfflictionKeySchema).default([]),
  compel: z.enum(LIMIT_STRESS_ACTIONS).nullable().default(null),
  constraint: z.enum(COMPULSION_CONSTRAINTS).nullable().default(null),
  pacified: z.boolean().default(false),
}).strip()
export type MoraleSpellOutcome = z.infer<typeof MoraleSpellOutcomeSchema>

// spells.tex "Telepathic Link": the test one target of a spell worked through
// a link makes against it, opened by the cast once it hit — the caster's
// action, the target's die. `accepted` is a target who takes it without a
// test ("or with anyone who allows the link"). `facts` is what reaches the
// target.
export const SpellTestActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('spellTest'),
  key: str.default(''),
  accepted: z.boolean().default(false),
  facts: DeliveriesSchema.nullable().default(null),
  morale: MoraleSpellOutcomeSchema.nullable().default(null),
}).strip()

// combat.tex "Defend": the four active defenses, each a reaction to a strike.
export const EvadeActionSchema = z.object({ ...ActionBase, kind: z.literal('evade') }).strip()
// combat.tex "Crash": the target of a trample standing firm — "The target
// can spend 2AP+1STA to get +3 in this comparison"
export const BraceActionSchema = z.object({ ...ActionBase, kind: z.literal('brace') }).strip()
// An evasive jump names where it lands (combat.tex "Evasive Jump": "jump
// away from the attack"); null on a fight without a board.
export const EvasiveJumpActionSchema = z.object({ ...ActionBase, kind: z.literal('evasiveJump'), to: PlacementSchema.nullable().default(null) }).strip()
// A block or an intercept names where its defender steps before they make
// it, if they do (abilities.tex "Defender", "Defensive Advance"); an
// intercept made as a Defensive Advance is `advance`.
const GuardStep = { to: PlacementSchema.nullable().default(null) }
// combat.tex "Preparing a reaction": the preparation a defense was prepared as,
// by id; '' for one made on the spot. Its reposition is walked before the die.
const PreparedGuard = { preparedId: str.default('') }
export const BlockActionSchema = z.object({ ...ActionBase, kind: z.literal('block'), ...WeaponRowRef, ...GuardStep, ...PreparedGuard }).strip()
export const InterceptActionSchema = z.object({ ...ActionBase, kind: z.literal('intercept'), ...WeaponRowRef, ...GuardStep, ...PreparedGuard, advance: z.boolean().default(false) }).strip()

// combat.tex "Reflex": the two reactions to a shot. Evasion is the reflex
// test; where it lets the evader move, the move is opened after the shot,
// unless the evader declared they `stay` where they are (abilities.tex
// "Precise Reflexes": "uses reflexes without moving"). A guard names the
// DEF row it is made with, and may be made by the target or by someone
// adjacent standing nearer the shooter. One made with a body shield may
// `cover`: once it lands, its guard stays in total cover behind the shield
// (combat.tex "Cover").
export const EvasionActionSchema = z.object({ ...ActionBase, kind: z.literal('evasion'), stay: z.boolean().default(false) }).strip()
export const GuardActionSchema = z.object({ ...ActionBase, kind: z.literal('guard'), ...WeaponRowRef, ...PreparedGuard, cover: z.boolean().default(false) }).strip()

// combat.tex "Avoiding an Explosion": the reaction to an explosion, a reflex
// test of the reactor's own against the explosion's DL. The die is on the
// reaction's `roll`, thrown with the root's; what its degree lets the
// reactor do is a move opened before or after the blast.
export const AvoidExplosionActionSchema = z.object({ ...ActionBase, kind: z.literal('avoidExplosion') }).strip()

// combat.tex "Explosion Block": the other reaction to an explosion, a reflex
// test with the cover of the shield it names; a hit or better lets the
// shield's defenses reduce what reaches the reactor.
export const BlockExplosionActionSchema = z.object({ ...ActionBase, kind: z.literal('blockExplosion'), ...WeaponRowRef }).strip()

// Where a move actually ended and why: the path as walked, cut short by a
// reaction that interrupted it, by the mover's own jump
// away from one (a movement of its own, which takes over), by a fall on
// difficult terrain, or by someone fleeing it.
export const MoveStopSchema = z.enum(['end', 'reaction', 'jump', 'fall', 'trample', 'flee'])
export type MoveStop = z.infer<typeof MoveStopSchema>

// The fall a move ends in: how far the mover drops, and the cell they land on
// when it is not the one the move left them on (combat.tex "Climbing": "On a
// failure, the character simply falls from the surface").
export const MoveFallSchema = z.object({ height: num.default(0), to: CoordSchema.nullable().default(null) }).strip()
export type MoveFall = z.infer<typeof MoveFallSchema>

export const MoveFactsSchema = z.object({
  path: z.array(CoordSchema).default([]),
  stop: MoveStopSchema.default('end'),
  fell: z.boolean().default(false),
  fall: MoveFallSchema.nullable().default(null),
  trampled: z.array(TrampleSchema).default([]),
  // combat.tex "Climbing": how a climb leaves its climber once it is over —
  // prone at the top, or standing where a climb no taller than they are
  // came to; combat.tex "Movement": a swim that came out of the water onto
  // land leaves its swimmer prone
  finish: z.enum(['prone', 'standing']).nullable().default(null),
  // combat.tex "Climbing": where a climb that stopped short of the top left its
  // climber, hanging on the face
  hang: z.object({ to: CoordSchema, covered: num, upright: z.boolean(), elevation: num }).strip().nullable().default(null),
}).strip()
export type MoveFacts = z.infer<typeof MoveFactsSchema>

// combat.tex "Movement": a move is a path of anchor cells, each a step from
// the last, taken at one kind of movement, ending in any orientation (null
// keeps the current one). It has no target and no die: it is committed by
// paying for it.
export const MoveActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('move'),
  movement: MoveKindSchema.default('basic'),
  path: z.array(CoordSchema).default([]),
  orientation: DirectionSchema.nullable().default(null),
  // combat.tex "Swimming": metres a swimmer goes deeper by the move's end,
  // below zero towards the surface, swum like a metre of the path
  dive: num.default(0),
  // play.tex "Safe and risky tests": how the climbing test is thrown, among
  // the ways the climber's abilities allow (abilities.tex "Climber")
  mode: z.enum(ROLL_MODES).default('normal'),
  // the test its die was thrown as, once it has been
  test: z.enum(['climb', 'balance']).nullable().default(null),
  // the held tests its mover had made in the round when it was committed, by
  // kind; null while it is still being declared, when the round's are read
  held: z.partialRecord(z.enum(HELD_TESTS), HeldRollSchema).nullable().default(null),
  // combat.tex "Climbing": the test each opportunity attack drawn against
  // the climb would have the climber make if it interrupted them, at a
  // penalty, in the order the attacks are fought and thrown with the climb's
  // own die
  redos: z.array(ActionRollSchema).default([]),
  // combat.tex "Climbing": a graze the climber could not pay the doubled
  // price of gives up the climb, and falls
  gaveUp: z.boolean().default(false),
  // abilities.tex "Jumper II": the climber spends a jump to start the climb
  // higher
  leap: z.boolean().default(false),
  // combat.tex "Climbing": how many metres of the face the climb goes, null
  // for all that is left of it
  metres: num.nullable().default(null),
  // the most AP it may cost, for a move a reaction opened (combat.tex
  // "Follow": "cannot cost more AP than" the move it answers; "Evasion":
  // "use up to 2 AP to move"); null is no cap
  budget: num.nullable().default(null),
  // the AP the reaction that opened it already paid towards it (combat.tex
  // "Evasion": the reflex's AP "is used to move and does not need to be
  // spent again, but any STA cost must be paid")
  prepaid: num.default(0),
  // the kinds of movement the reaction that opened it allows, whatever the
  // mover could otherwise make (combat.tex "Avoiding an Explosion": on a
  // critical "the character can run", on a hit "jump in any direction") —
  // each degree's kinds and everything a lesser degree would have granted,
  // so the mover is never forced into the privileged one; null is the
  // mover's usual choice
  movements: z.array(MovementKindSchema).nullable().default(null),
  // where the mover set out from, written at the commit: the path is read
  // from here even once an opportunity attack has the mover standing part
  // of the way along it
  from: PlacementSchema.nullable().default(null),
  facts: MoveFactsSchema.nullable().default(null),
}).strip()

// combat.tex "Opportunity Attack" and "Flanking": declared as a reaction to
// a strike (by a flanker), a move (by whoever the mover comes at), or any
// other triggering action (by anyone who threatens its actor), and opens a
// strike of its own before the action it answers lands ("The attack occurs
// before the effect of the triggering action"). The
// strike is declared here, in full, before the root is paid for: what it
// opens is already committed. `at` is the path step of a move at which it
// fired; the mover stands one space short of that stretch while it is
// fought, and stays there if it interrupts.
export const OpportunityAttackActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('opportunityAttack'),
  at: num.nullable().default(null),
  ...StrikeDeclaration,
  ...AttackAim,
  // combat.tex "Grapple Maneuvers": "can be used like opportunity attacks"
  // — against a grapple partner, what is opened is a maneuver instead of a
  // strike
  mode: z.enum(['strike', 'grapple']).default('strike'),
  maneuver: GrappleManeuverSchema.default('immobilize'),
}).strip()

// The holder of a sustained spray aiming it anew as a reaction, on the same
// triggers as an opportunity attack but within the spray's reach: it opens a
// fireAgain that moves only the ground the spray lays, before the action it
// answers lands. `at` is the path step of a move at which it fired.
export const RetargetActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('retarget'),
  key: str.default(''),
  at: num.nullable().default(null),
}).strip()

// combat.tex "Coordinated Shots": a shot at the target of one being made,
// declared in full as a reaction to it — the row, the way of shooting, where
// it aims and what it is loaded with — and opened as a shot of its own before
// the shot it joins lands. It is aimed at the target of that shot.
export const JoinShotActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('joinShot'),
  ...ShotDeclaration,
  ...AttackAim,
}).strip()

// abilities.tex "Counterattack": the target's answer to a strike, declared
// with the strike it opens in full. Its die is thrown with the attack's, and
// the two results say which of them lands first (rules/counter.ts).
export const CounterattackActionSchema = z.object({ ...ActionBase, kind: z.literal('counterattack'), ...StrikeDeclaration, ...AttackAim }).strip()

// combat.tex "Preparing a reaction": what a prepared action waits for. `enters`
// is a character coming into the zone the action reaches, its own reach and
// the movement it may carry; `sighted` is a character coming into sight, as a
// prepared shot waits for (combat.tex "Prepared Shots"). `attacked` is for a
// defense made on someone's behalf (combat.tex "Protect", "Guard"): the
// character it protects is attacked. `who` names the one it waits for, null
// for anyone.
export const PREPARED_EVENTS = ['enters', 'sighted', 'attacked'] as const
export const PreparedTriggerSchema = z.object({
  event: z.enum(PREPARED_EVENTS),
  who: str.nullable().default(null),
}).strip()
export type PreparedTrigger = z.infer<typeof PreparedTriggerSchema>

// What can be prepared: the roots, and the defenses made on someone else's
// behalf, which are reactions to the attack on them.
export const PREPARABLE_KINDS = ['strike', 'shoot', 'cast', 'move', 'block', 'intercept', 'guard'] as const
export const PreparableKindSchema = z.enum(PREPARABLE_KINDS)
export type PreparableKind = z.infer<typeof PreparableKindSchema>

// combat.tex "Preparing a reaction": "Any action can be prepared on a player's
// turn, but doing so costs 1 AP ... A prepared action can consist of 2 AP of
// movement and one other action". The action is declared first (`main`, with
// what it is made with: a strike's or a shot's declaration, the spell, the
// way of moving), and the
// triggers it can wait for are offered from that. What it is aimed at is
// declared when it fires. It always carries the 2 AP of movement. A
// prepared action stays prepared until the end of the round it was made in,
// so it needs no record of its own: it is read off the log (rules/prepared.ts).
export const PrepareActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('prepare'),
  main: PreparableKindSchema.nullable().default(null),
  ...StrikeDeclaration,
  ...ShotDeclaration,
  key: str.default(''),
  quicken: z.boolean().default(false),
  extend: num.default(0),
  movement: MoveKindSchema.default('basic'),
  trigger: PreparedTriggerSchema.nullable().default(null),
}).strip()

// A prepared action whose trigger has happened, answered by its preparer:
// declared as a reaction to the committed action, and opened before that
// action lands (combat.tex "Reactions": "A reaction takes effect before the
// action that caused it"). It opens the movement it may carry, which its
// preparer may skip, and then the action itself. `at` is counted as an
// opportunity attack's is, from a move's path, so the mover is stood one step
// short of it: on the cell that brought them into the trigger.
export const PreparedActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('prepared'),
  preparedId: str.default(''),
  at: num.nullable().default(null),
}).strip()

// combat.tex "Follow": a reaction to a move by someone in melee range; when
// the root resolves it opens a move of the follower's own, capped at what
// the triggering move cost.
export const FollowActionSchema = z.object({ ...ActionBase, kind: z.literal('follow') }).strip()

// combat.tex "Flee": the movement surge made as a reaction to a move about
// to come within 4 m of the fleer. It opens no action: once the move has
// been played out, the fleer takes a turn of their own (rules/flee.ts).
// `at` is the step of the move's path that fired it; the mover stops one
// space short of it.
export const FleeActionSchema = z.object({ ...ActionBase, kind: z.literal('flee'), at: num.nullable().default(null) }).strip()

// combat.tex "Flee": "after receiving a melee attack" — the flee a landed
// strike leaves its target, and the escape a missed shot leaves its evader
// ("Evasion": "spend their movement surge immediately to escape"), for them
// to take or pass up, passing it up unless they say otherwise. Taken, it
// makes the movement surge, and the fleer's turn comes once the stack is
// played out.
export const FleeFollowUpActionSchema = z.object({ ...ActionBase, kind: z.literal('fleeFollowUp'), flee: z.boolean().default(false) }).strip()

// combat.tex "Grapple Maneuvers": escape, immobilize, disarm or knock down
// a grapple partner, a grapple test against theirs. What a hit buys is the
// attacker's call once the die is known: `along` is their own commitment —
// "throw oneself along" for a knockdown, "stay immobilized yourself" for an
// immobilization — and `item` what a disarm goes for. `unresisted` is the escape "Being stunned allows for", "without the
// possibility of active resistance". `opportunity` is one made as an
// opportunity attack.
export const GrappleActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('grapple'),
  maneuver: GrappleManeuverSchema.default('escape'),
  along: z.boolean().default(false),
  item: str.default(''),
  unresisted: z.boolean().default(false),
  opportunity: z.boolean().default(false),
  facts: GrappleFactsSchema.nullable().default(null),
}).strip()

// combat.tex "Push and drag": one block of movement within a grapple —
// "The comparison is repeated for every 2 AP worth of movement" — decided
// by a Force comparison between the actor's side and everyone else locked
// in the grapple. `movement` is how it moves: pushing or dragging
// "forwards or backwards with careful movement speed" along the line
// through the target, circling around the grapple "with basic movement" by
// the actor alone, or running along that line "when force is 10 higher".
// `path` is the actor's way, cell by cell. `boost` is the actor's "spend 2
// AP to gain 5 force in one comparison". No die: once the grapple has
// answered, the comparison is written as the price is paid (`compared`),
// and third parties answer the way as they answer a move. Written at the
// resolve: who let go instead of being moved, and where everyone ended.
export const DragFactsSchema = z.object({
  released: z.array(str).default([]),
  steps: num.default(0),
  to: z.record(str, PlacementSchema).default({}),
}).strip()
export type DragFacts = z.infer<typeof DragFactsSchema>
export const PushMovementSchema = z.enum(PUSH_MOVEMENTS)
export type PushMovement = z.infer<typeof PushMovementSchema>
export const DragActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('drag'),
  // gear.tex "Net": a pull along a tether, which moves the one at its far end
  // toward the actor and nobody else
  pull: z.boolean().default(false),
  movement: PushMovementSchema.default('careful'),
  path: z.array(CoordSchema).default([]),
  boost: z.boolean().default(false),
  // the comparison as it stood when the push was paid for — each side's
  // terms, whose +5 counted, and whether the block may be moved — written
  // once, like a die, whatever befalls either side while its attacks are
  // fought
  compared: z.object({
    attacker: z.array(TermSchema),
    defender: z.array(TermSchema).nullable(),
    boosted: z.array(str).default([]),
    allowed: z.boolean().default(false),
  }).nullable().default(null),
  facts: DragFactsSchema.nullable().default(null),
}).strip()

// A holder letting go of a partner who does not hold them back.
export const ReleaseActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('release'),
  facts: GrappleFactsSchema.nullable().default(null),
}).strip()

// gear.tex "Net": the tethered slipping the net they were caught in, a
// Prestidigitation test against the DL of the tether.
export const SlipActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('slip'),
}).strip()

// combat.tex "Turns and Actions" ("Feint"): a cunning test against a character
// in melee; on a hit or a critical the target is forced to take their turn
// and use an action surge, otherwise the feinter is.
export const FeintActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('feint'),
}).strip()

// gear.tex "Equipment Breakage": a strike at a net, scored against no defense;
// `breakRoll` is the percentile thrown with it for the net's chance to break.
export const CutActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('cut'),
  ...AttackMade,
  breakRoll: num.default(0),
}).strip()

// Grappling back a partner one holds nothing of, once a grapple row is in
// hand.
export const HoldBackActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('holdBack'),
  facts: GrappleFactsSchema.nullable().default(null),
}).strip()

// Picking up: an item off the floor, from the character's own
// cell or one next to it, into a free hand.
export const PickUpActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('pickUp'),
  itemId: str.default(''),
  // what was picked up, written at the resolve
  picked: ItemSchema.nullable().default(null),
}).strip()

// combat.tex "Throw", "Standard Action": an item thrown to a cell on the
// floor — a held weapon with a throwing row thrown with that row, anything
// else "with bulk smaller than character size by up to 10m", from a free
// hand or off the floor. One of a stack goes.
export const ThrowActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('throw'),
  itemId: str.default(''),
  to: CoordSchema.nullable().default(null),
  // what was thrown, written at the resolve
  thrown: ItemSchema.nullable().default(null),
}).strip()

// gear.tex "Potions and Medicine": "Potions require a standard action to be
// consumed" — a potion held in hand, drunk.
export const DrinkActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('drink'),
  itemId: str.default(''),
  // what was drunk, written at the resolve
  drunk: ItemSchema.nullable().default(null),
}).strip()

// abilities.tex "First Aid": "Tries to stop bleeding through a tourniquet or
// pressure on self or other" — a medicine test against twice the target's
// bleed; what it did to them, written at the resolve.
export const FirstAidActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('firstAid'),
  facts: DeliveriesSchema.nullable().default(null),
}).strip()

// abilities.tex "Cauterization": "Tries to stop bleeding through burning the
// area", no test; what it did to the target, written at the resolve.
export const CauterizeActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('cauterize'),
  facts: DeliveriesSchema.nullable().default(null),
}).strip()

// gear.tex "Reload": "The weapon requires reloading to attack again" — a
// row with the property in hand, loaded with one arrow or bolt from the
// stack named in a quick slot.
export const ReloadActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('reload'),
  ...WeaponRowRef,
  ammoId: str.default(''),
  // what went into the weapon, written at the resolve
  loaded: ItemSchema.shape.loaded,
}).strip()

// combat.tex "Fire": muffling a fire, in the burning space of the actor or
// next to it.
export const ExtinguishActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('extinguish'),
  to: CoordSchema.nullable().default(null),
}).strip()

// combat.tex "Rest": "an action that costs 4 AP and recovers STA by an
// amount equal to STA/4".
export const RestActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('rest'),
}).strip()

// combat.tex "Social actions": what the character says, counted as a rest.
// Intimidation goes to every enemy, a rally and an abusive's insult
// (creating.tex "Limit Stress Actions") to the party; a negotiation's test and
// what it comes to are the table's; surrendering raises the flag and
// unsurrendering lowers it.
export const SocialSaySchema = z.enum(['intimidate', 'rally', 'insult', 'negotiate', 'surrender', 'unsurrender'])
export type SocialSay = z.infer<typeof SocialSaySchema>

export const SocialActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('social'),
  say: SocialSaySchema.default('intimidate'),
}).strip()

// combat.tex "Taunt": said to the one enemy picked as its target.
export const TauntActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('taunt'),
}).strip()

// combat.tex "Balance" ("Fall skill test"): the actor falling `height` metres,
// a Balance test of their own whose degree decides the landing, opened by
// whatever put them in the air. `to` is the cell they land on when it is not
// the one they stand on; the ground there sets how high they land. `facts` is
// what the landing does to the actor.
export const FallActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('fall'),
  height: num.default(0),
  to: CoordSchema.nullable().default(null),
  facts: DeliveriesSchema.nullable().default(null),
}).strip()

// combat.tex "Swimming": "When entering the water ... make a swimming check
// against the DL of the body of water", the actor's own test, opened by the
// move that put them in it; its roll is theirs for the round.
export const SwimTestActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('swimTest'),
}).strip()

// combat.tex "Grapple Maneuvers": "require the defender to spend 2 AP+1 STA
// or suffer a -5 penalty". combat.tex "Push and drag": resisting a push is
// the defender's "spend 2 AP to gain 5 force"; one who chooses nothing
// stays put at their Force, as does one with no AP left to move ("help the
// losing side passively"). Everyone else in the group chooses too: to help
// the push, walking with the group and paying its movement ("Use the same
// rules for multiple characters as grapple"), boosting it or not; to "tag
// along, spending movement AP to stay in the grapple, but not contributing
// to either side"; or — held by nobody — to "let go and leave the grapple".
export const ResistActionSchema = z.object({ ...ActionBase, kind: z.literal('resist') }).strip()
export const AssistActionSchema = z.object({ ...ActionBase, kind: z.literal('assist'), boost: z.boolean().default(false) }).strip()
export const CarryActionSchema = z.object({ ...ActionBase, kind: z.literal('carry') }).strip()
export const LetGoActionSchema = z.object({ ...ActionBase, kind: z.literal('letGo') }).strip()
export const ActionSchema = z.discriminatedUnion('kind', [
  StrikeActionSchema,
  ShootActionSchema,
  ExplosionActionSchema,
  BlastActionSchema,
  CastActionSchema,
  FireAgainActionSchema,
  SpellTestActionSchema,
  EvasionActionSchema,
  GuardActionSchema,
  AvoidExplosionActionSchema,
  BlockExplosionActionSchema,
  EvadeActionSchema,
  BraceActionSchema,
  EvasiveJumpActionSchema,
  BlockActionSchema,
  InterceptActionSchema,
  OpportunityAttackActionSchema,
  RetargetActionSchema,
  JoinShotActionSchema,
  CounterattackActionSchema,
  PreparedActionSchema,
  FollowActionSchema,
  FleeActionSchema,
  FleeFollowUpActionSchema,
  PrepareActionSchema,
  MoveActionSchema,
  GrappleActionSchema,
  DragActionSchema,
  ReleaseActionSchema,
  SlipActionSchema,
  FeintActionSchema,
  CutActionSchema,
  HoldBackActionSchema,
  PickUpActionSchema,
  ThrowActionSchema,
  DrinkActionSchema,
  FirstAidActionSchema,
  CauterizeActionSchema,
  ReloadActionSchema,
  ExtinguishActionSchema,
  RestActionSchema,
  SocialActionSchema,
  TauntActionSchema,
  FallActionSchema,
  SwimTestActionSchema,
  ResistActionSchema,
  AssistActionSchema,
  CarryActionSchema,
  LetGoActionSchema,
])

export type Action = z.infer<typeof ActionSchema>
export type ActionKind = Action['kind']
export type StrikeAction = z.infer<typeof StrikeActionSchema>
export type ShootAction = z.infer<typeof ShootActionSchema>
// The two weapon attacks: what is rolled against a defense and lands as an
// injury, declared as a weapon row, a variation and a location.
export type AttackAction = StrikeAction | ShootAction
export type ExplosionAction = z.infer<typeof ExplosionActionSchema>
export type BlastAction = z.infer<typeof BlastActionSchema>
export type CastAction = z.infer<typeof CastActionSchema>
export type FireAgainAction = z.infer<typeof FireAgainActionSchema>
export type SpellTestAction = z.infer<typeof SpellTestActionSchema>
export type MoveAction = z.infer<typeof MoveActionSchema>
export type GrappleAction = z.infer<typeof GrappleActionSchema>
export type DragAction = z.infer<typeof DragActionSchema>
export type ReleaseAction = z.infer<typeof ReleaseActionSchema>
export type SlipAction = z.infer<typeof SlipActionSchema>
export type FeintAction = z.infer<typeof FeintActionSchema>
export type CutAction = z.infer<typeof CutActionSchema>
export type HoldBackAction = z.infer<typeof HoldBackActionSchema>
export type ActionOf<K extends ActionKind> = Extract<Action, { kind: K }>
// What an opportunity attack opens: a strike, or against a grapple partner a
// maneuver (combat.tex "Grapple Maneuvers").
export type OpportunityAction = StrikeAction | GrappleAction
export type PickUpAction = z.infer<typeof PickUpActionSchema>
export type ThrowAction = z.infer<typeof ThrowActionSchema>
export type ExtinguishAction = z.infer<typeof ExtinguishActionSchema>
export type DrinkAction = z.infer<typeof DrinkActionSchema>
export type FirstAidAction = z.infer<typeof FirstAidActionSchema>
export type CauterizeAction = z.infer<typeof CauterizeActionSchema>
export type ReloadAction = z.infer<typeof ReloadActionSchema>
export type RestAction = z.infer<typeof RestActionSchema>
export type SocialActionRecord = z.infer<typeof SocialActionSchema>
export type TauntAction = z.infer<typeof TauntActionSchema>
export type PrepareAction = z.infer<typeof PrepareActionSchema>
export type FallAction = z.infer<typeof FallActionSchema>
export type SwimTestAction = z.infer<typeof SwimTestActionSchema>
// The actions, not reactions, the catalog does not mark `movement`
// (rules/actionCatalog.ts): those a reaction made in their middle
// interrupts.
export type InterruptibleAction = ActionOf<{ [K in ActionKind]: (typeof ACTIONS)[K] extends { movement: true } | { type: 'reaction' } ? never : K }[ActionKind]>
// The kinds the catalog marks reactions, and every action that is not one:
// a root, taken on its actor's own initiative or generated by another's
// effect. A reaction is never played out on its own (rules/log.ts
// `getOpenAction`).
export type ReactionKind = { [K in ActionKind]: (typeof ACTIONS)[K] extends { type: 'reaction' } ? K : never }[ActionKind]
export type ReactionAction = ActionOf<ReactionKind>
export type RootAction = Exclude<Action, ReactionAction>
// The roots a player declares: every one the catalog does not mark
// `generated`.
export type DeclarableKind = Exclude<ActionKind, ReactionKind | { [K in ActionKind]: (typeof ACTIONS)[K] extends { generated: true } ? K : never }[ActionKind]>

// The declaration a click makes: an action minus everything the commands fill
// in (identity, step, the roll, the facts). What is left is the kind and its
// own declared fields, each optional so a bare kind can be declared and
// completed step by step.
export type ActionDraft = {
  [K in ActionKind]: { kind: K } & Partial<Omit<ActionOf<K>, keyof typeof ActionBase | 'kind' | 'facts'>>
}[ActionKind]

// combat.tex "Morale": a character called to a morale test at the beginning of
// the round, and — once it is made — what it was and whether it activated
// their limit stress action.
export const MoraleRollSchema = z.object({
  mode: z.enum(ROLL_MODES),
  die: z.number(),
  skill: z.number(),
  score: z.number(),
  DL: z.number(),
  degree: DegreeSchema,
  limitStress: z.boolean(),
})
export const MoraleCallSchema = z.object({ id: z.string(), roll: MoraleRollSchema.nullable().default(null) })
// The steps of the round change the table moves on from by hand; what runs on
// its own between them, and the steps inside the last one, are read off the
// state (rules/roundChange.ts).
export const RoundStepSchema = z.enum(['rest', 'concentration', 'join', 'morale'])
export type RoundStep = z.infer<typeof RoundStepSchema>
// What a character holding something on through the round change chose: to
// pay for it again, or to let it go and finish what it held.
export const ConcentrationChoiceSchema = z.object({ id: z.string(), hold: z.boolean() })
// combat.tex "Actions in stealth": what a turn's holder may use their stealth
// value against. `hiddenFrom` is everyone the holder began the turn
// undetected by; `AP` what their actions in the turn have spent that "add -1
// per AP spent", and `heardAP` that again for each source of noise they make
// ("Hearing: Terrain noise and gear noise"), which only an ear hears.
export const StealthTurnSchema = z.object({ turn: num, id: str, hiddenFrom: z.array(str).default([]), AP: num.default(0), heardAP: num.default(0) })

export const BodyCoverSchema = z.object({ weaponKey: str, toward: CoordSchema }).strip()
export type BodyCover = z.infer<typeof BodyCoverSchema>
export type StealthTurn = z.infer<typeof StealthTurnSchema>

// The round's held test of a character, by kind (`HeldRollSchema`). A call
// with no roll is a test owed.
export const HeldTestSchema = z.object({ id: z.string(), kind: z.enum(HELD_TESTS), roll: HeldRollSchema.nullable().default(null) })
export type HeldTest = z.infer<typeof HeldTestSchema>

// combat.tex "Social actions": what a character said to another in the round
// `round`, weighing on that one's morale test at the next round's beginning.
export const PressureSchema = z.object({
  round: z.number(),
  from: z.string(),
  target: z.string(),
  kind: z.enum(PRESSURE_KINDS),
  value: z.number(),
})
export type Pressure = z.infer<typeof PressureSchema>

// combat.tex "Compulsions": a character a miss in a morale test owes their
// limit stress action, `action` as it stands after the book's substitutions
// (a martyr who is enraged is violent; an abusive or a traitor the table finds
// nobody for is a coward). `acted` is whether the social action it compels has
// been taken; `taken` whether their turn for it is over. `by` is the caster
// whose spell the test was ('' for the round's own test), and `constraint`
// what the spell binds the action to.
export const CompulsionSchema = z.object({
  id: z.string(),
  action: z.enum(LIMIT_STRESS_ACTIONS),
  acted: z.boolean().default(false),
  taken: z.boolean().default(false),
  by: z.string().default(''),
  constraint: z.enum(COMPULSION_CONSTRAINTS).nullable().default(null),
})
export type Compulsion = z.infer<typeof CompulsionSchema>
export type MoraleRoll = z.infer<typeof MoraleRollSchema>
export type MoraleCall = z.infer<typeof MoraleCallSchema>

// A contest for the turn as it was rolled: each contender's cunning roll, in
// the order they asked, the holder first, and who took the turn.
export const ContestRollSchema = z.object({ id: z.string(), die: z.number(), skill: z.number(), score: z.number() })
export const ContestSchema = z.object({ rolls: z.array(ContestRollSchema), winner: z.string() })
export type ContestRoll = z.infer<typeof ContestRollSchema>

// A turn waiting to be taken: whose, whether it is a flee, and — for one
// that was interrupted — how long the log was when it first started, so it
// resumes as the turn it was
export const QueuedTurnSchema = z.object({ id: z.string(), fleeing: z.boolean().default(false), turn: z.number().nullable().default(null) })
export type QueuedTurn = z.infer<typeof QueuedTurnSchema>
export type Contest = z.infer<typeof ContestSchema>

// Why a committed action, or an offer made to someone, left play without
// landing: an answer taken back, or changed for another; a follow-up passed up,
// or forgone for another the same actor took; an answer the action it was made
// to no longer triggered; a held action given up for a defense, broken by an
// interruption, or failed for want of what it needs when it came to finish.
export const WithdrawalReasonSchema = z.enum(['tookBack', 'replaced', 'passedUp', 'forgone', 'noLongerTriggered', 'givenUp', 'interrupted', 'failed'])
export type WithdrawalReason = z.infer<typeof WithdrawalReasonSchema>

// What was withdrawn, as it stood, and when.
export const JournalEntrySchema = z.object({ action: ActionSchema, reason: WithdrawalReasonSchema, round: num, turn: num })
export type JournalEntry = z.infer<typeof JournalEntrySchema>

// What a command outside any action changed on a character — a surge, an item
// drawn or stowed, a sheet edit — and what it was, with the number of actions
// that had landed when it was made.
export const EditEntrySchema = z.object({ cause: str, round: num, turn: num, landed: num, changes: z.array(ChangeSchema) }).strip()
export type EditEntry = z.infer<typeof EditEntrySchema>

// The shape of a fight. This lives in the domain — not in the Zustand store —
// so the combat commands can be pure `(state) => state` updaters with no
// dependency on the state layer. The store composes this with its actions.
//
// It is a schema rather than a plain type because a combat is persistable:
// the same parse-with-defaults path that ingests characters can rehydrate a
// saved fight, and every field carries a default so a partial or older payload
// still lands on a complete SceneState.
// A party in the fight: one the campaign sent its characters in, under the
// campaign's id, or one made in the fight.
export const FightPartySchema = z.object({ name: str.default('') })
export type FightParty = z.infer<typeof FightPartySchema>

// combat.tex "Running": what one link of the chain came to this round — the
// tier it was run at, each runner's speed and each end's (its slowest
// runner's), whether the speeds were compared (only when the two ends ran
// opposite ways), who won, the percentile die a sustained draw was settled
// with, the way the distance went, and whether it is a skirmish, whose way
// lands when the round ends ("At the end, both teams will be in combat
// range"). Written once, like a die.
export const ChaseRunSchema = z.object({
  tier: z.enum(CHASE_TIERS),
  speeds: z.record(str, num).default({}),
  chaser: num.default(0),
  chased: num.default(0),
  contest: z.boolean().default(false),
  winner: z.enum(CHASE_ROLES).nullable().default(null),
  coin: num.nullable().default(null),
  way: z.enum(CHASE_WAYS).nullable().default(null),
  skirmish: z.boolean().default(false),
}).strip()
export type ChaseRun = z.infer<typeof ChaseRunSchema>

// combat.tex "Group chases": a party chasing another — one of its own team
// left behind chases the faster ones — at a distance tier, and this round's
// run between the two.
export const ChaseLinkSchema = z.object({
  chases: str,
  tier: z.enum(CHASE_TIERS).default('combat'),
  run: ChaseRunSchema.nullable().default(null),
}).strip()
export type ChaseLink = z.infer<typeof ChaseLinkSchema>

// combat.tex "Chase actions": what a party does this round — and, running,
// what it scouts for ("They will describe what they are looking for. The
// odds that such a place exists will be a test with an arbitrary DL"), or,
// hiding, what the table adds to its stealth ("penalties for the amount of
// characters, gear carried [...]"; "The hiding spot [...] can grant stealth
// bonuses").
export const ChaseScoutSchema = z.object({ what: str.default(''), DL: num.default(0), obstacle: z.boolean().default(false) }).strip()
export type ChaseScout = z.infer<typeof ChaseScoutSchema>
export const ChaseDeclarationSchema = z.object({
  move: z.enum(CHASE_MOVES),
  scout: ChaseScoutSchema.nullable().default(null),
  hideModifier: num.default(0),
}).strip()
export type ChaseDeclaration = z.infer<typeof ChaseDeclarationSchema>

// combat.tex "Scouting": a place a party found, the tier it is at ("is
// approached one tier per round"), whether it is an obstacle, and whether the
// party has got there.
export const ChaseFeatureSchema = z.object({
  what: str.default(''),
  tier: z.enum(CHASE_TIERS).default('shooting'),
  obstacle: z.boolean().default(false),
  reached: z.boolean().default(false),
}).strip()
export type ChaseFeature = z.infer<typeof ChaseFeatureSchema>

// A test the chase made this round, kept to be read: hiding (the parties
// that hid together, and the one found), scouting or crossing an obstacle.
export const ChaseRollSchema = z.object({
  kind: z.enum(['hide', 'scout', 'cross']),
  parties: z.array(str).default([]),
  found: str.nullable().default(null),
  roll: TestRollSchema,
}).strip()
export type ChaseRoll = z.infer<typeof ChaseRollSchema>

// combat.tex "Chases": the parties on the team that ran away first (everyone
// else gave chase); the party each party chases, the chain; who is out of it
// ("Disconnected party"), caught and fighting, separated (hid with a group
// that was found, and has not yet decided what to do), or on the way to join
// a fight; what each party declared this round, and whether the round has
// been resolved, how long it took and the tests it made; the places parties
// found; who of a chased party has turned around to face the chasers; and
// who the table has in cover.
export const ChaseSchema = z.object({
  runaways: z.array(str).default([]),
  links: z.record(str, ChaseLinkSchema).default({}),
  out: z.array(str).default([]),
  fighting: z.array(str).default([]),
  separated: z.array(str).default([]),
  joining: z.record(str, str).default({}),
  declarations: z.record(str, ChaseDeclarationSchema).default({}),
  resolved: z.boolean().default(false),
  seconds: num.nullable().default(null),
  rolls: z.array(ChaseRollSchema).default([]),
  features: z.record(str, ChaseFeatureSchema).default({}),
  turned: z.array(str).default([]),
  cover: z.record(str, z.enum(CHASE_COVERS)).default({}),
}).strip()
export type Chase = z.infer<typeof ChaseSchema>

export const SceneStateSchema = z.object({
  characters: z.record(z.string(), CampaignCharacterSchema).default({}),
  activeCharacterId: z.string().nullable().default(null),
  // the parties the fight's characters are in, by id, in the order they
  // joined the fight, and the party each character is in; who is in which is
  // the table's to change until the fight gives them back to the campaign
  parties: z.record(str, FightPartySchema).default({}),
  partyOf: z.record(str, str).default({}),
  round: z.number().default(0),
  // the game time the scene's rounds have taken, in seconds
  elapsed: num.default(0),
  // Null is a fight; otherwise the scene is a chase (combat.tex "Chases"),
  // played without a board
  chase: ChaseSchema.nullable().default(null),
  // play.tex "Combat": whose turn it is, '' for nobody's, and which turn that
  // is (the number the actions declared in it carry) — the turn can be
  // contested until something is declared in it. `turnsBegun` numbers the
  // next turn that starts fresh; a resumed turn takes back its own number.
  inTurnCharacter: z.string().default(''),
  turn: z.number().default(0),
  turnsBegun: z.number().default(0),
  // who has asked to contest the turn, in the order they asked, and the
  // contest once it is rolled — a turn is contested once
  contenders: z.array(z.string()).default([]),
  lastContest: ContestSchema.nullable().default(null),
  // combat.tex "End of the round": who has said they agree to end it; who
  // has nothing left to spend agrees without saying so
  agreedToEnd: z.array(z.string()).default([]),
  // The round change under way, null while the round is played in turns
  roundStep: RoundStepSchema.nullable().default(null),
  // who has chosen, at this round change, to hold on to what they concentrate
  // on or let it go
  concentration: z.array(ConcentrationChoiceSchema).default([]),
  // combat.tex "Morale": who the beginning of this round called to a test, and
  // the tests made
  morale: z.array(MoraleCallSchema).default([]),
  // combat.tex "Compulsions": the limit stress actions the morale tests
  // activated, the worst test first, and those a spell's test activated, as
  // they landed — each taken as a turn before anyone else's, and kept to the
  // round's end for what a martyr still owes
  compulsions: z.array(CompulsionSchema).default([]),
  // The tests called or made once for the round, kept to the round's end
  heldTests: z.array(HeldTestSchema).default([]),
  // The round's turns something has been committed in, by the number its
  // actions carry, and who rested in each, kept to the round's end
  turnsTaken: z.array(z.object({ turn: num, rested: z.array(str).default([]) })).default([]),
  // The preparations landed in the round, by id, lapsing at its end
  // (combat.tex "Preparing a reaction")
  prepared: z.array(str).default([]),
  // combat.tex "Actions in stealth": each turn of the round, by its number,
  // who held it, whom they began it undetected by, and the AP their actions in
  // it have spent, all of it and what an ear hears more of (`StealthTurnSchema`)
  stealthTurns: z.array(StealthTurnSchema).default([]),
  // combat.tex "Cover": who has taken total cover behind a body shield after
  // a guard, by id — the shield, and the cell of the shot they guarded,
  // which the shield faces; kept, across rounds, until they land any action
  // but careful movement
  bodyCover: z.record(str, BodyCoverSchema).default({}),
  // combat.tex "Social actions": the intimidations, taunts and rallies said
  pressure: z.array(PressureSchema).default([]),
  // combat.tex "Morale", "Pressure": the table's judgment of how the fight
  // weighs on each party, by fight party id ('' for whoever is in none), kept
  // until the table changes it
  tablePressure: z.record(z.string(), num).default({}),
  // combat.tex "Surrender": who has flagged themselves surrendered
  surrendered: z.array(z.string()).default([]),
  // combat.tex "Flee": whether the turn being taken is a flee, and the turns
  // waiting on it, the next first — each fleer's, then the turn the flee
  // interrupted, resumed where it was ("which is resumed after the flee")
  fleeing: z.boolean().default(false),
  // combat.tex "Feint": who a feint forced to take their turn and use an
  // action surge, '' for nobody; owed until that surge is used
  forcedSurge: z.string().default(''),
  // gear.tex "Equipment Breakage": "The equipment breakage function is
  // optional" — whether blows put the objects they meet at risk
  breakage: z.boolean().default(true),
  turnQueue: z.array(QueuedTurnSchema).default([]),
  // the characters whose flee is due once what is being played out is
  // done, in the order they declared it
  fleers: z.array(z.string()).default([]),
  // Every action of the fight, still in play or played out, by id. What
  // answers or opened an action is found by its own link (`reactionTo`,
  // `spawnedBy`, `followUpOf`), never listed on the action it points to
  // (rules/log.ts indexes them). What is taken back leaves.
  actions: z.record(str, ActionSchema).default({}),
  // The actions still in play, by id, in the order they were declared: the
  // open one is the last root still short of resolved, and the reactions to
  // the roots being played out wait here with them.
  live: z.array(str).default([]),
  // The actions still being played out, by id, the one the table is waiting
  // on last. An action a reaction opens is pushed over the one it answers
  // and played out first; an action leaves when it resolves.
  stack: z.array(z.string()).default([]),
  // The actions that have been played out, by id, each with the reactions to
  // it, in the order they landed — which is not the order they were declared
  // in: an opportunity attack lands before the action it answers. Only ever
  // added to.
  landed: z.array(str).default([]),
  // What each character who has been in the fight goes by in it, which tells
  // copies of one sheet apart, kept once they have left so the log still
  // names them.
  names: z.record(str, str).default({}),
  // What was withdrawn from play without landing, in the order it was; only
  // ever added to.
  journal: z.array(JournalEntrySchema).default([]),
  // What commands outside any action changed on a character, in the order
  // they were made; only ever added to.
  edits: z.array(EditEntrySchema).default([]),
  // Null is a fight with no grid: every positional gate passes, and the
  // fight is played as it was before there was a board.
  board: BoardSchema.nullable().default(null),
  // Every bind of the fight: grapples (combat.tex "Grapple"), one per pair
  binds: z.array(BindSchema).default([]),
  floor: z.array(FloorItemSchema).default([]),
}).strip()

export type SceneState = z.infer<typeof SceneStateSchema>

// What every combat command is: a pure update of the fight.
export type Updater = (state: SceneState) => SceneState

// The campaign and the fight run beside it. A character is in one or the
// other, never both: a fight takes its characters off the roster and gives
// them back when it is over.
export type Table = { campaign: CampaignState; fight: SceneState }

export type TableUpdater = (table: Table) => Table
