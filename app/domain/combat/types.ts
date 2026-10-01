import { z } from 'zod'
import { CampaignCharacterSchema, DegreeSchema, DeliverySchema, ItemSchema, SpellEffectSchema, HitLocationSchema, InterruptionSchema, MoveKindSchema, MovementKindSchema, VisibilitySchema } from '../types'
import { GRAPPLE_AFFLICTIONS, GRAPPLE_MANEUVERS, HOP_PURCHASES, PUSH_MOVEMENTS } from '../lists'
import { SPELL_MODIFICATIONS } from '../tables'
import type { ACTIONS } from './rules/actionCatalog'

export { DEGREES, DegreeSchema, HitLocationSchema, InterruptionSchema } from '../types'
export type { Degree, HitLocation, Interruption } from '../types'

const num = z.number()
const str = z.string()

// What the die came to and what it meant, written once and never revised.
export const ActionRollSchema = z.object({
  die: num.default(0),
  DL: num.default(0),
  score: num.default(0), // die + skill + modifiers
  degree: DegreeSchema.default('miss'),
  HOP: num.default(0),
}).strip()
export type ActionRoll = z.infer<typeof ActionRollSchema>

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

// ---------------------------------------------------------------------------
// The board

// A hex cell in axial coordinates; one cell is one metre (combat.tex
// "Movement Costs and Speeds" prices basic movement at 1 AP per metre and
// "Movement" moves in whole spaces). The geometry that reads these is in
// `geometry.ts`.
export const CoordSchema = z.object({ q: num.default(0), r: num.default(0) }).strip()
export type Coord = z.infer<typeof CoordSchema>

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
  focus: str.nullable().default(null),
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
export const HazardLayerSchema = HazardSchema.extend({
  heldBy: z.object({ id: str.default(''), key: str.default(''), explosionId: str.default('') }).strip().nullable().default(null),
}).strip()
export type HazardLayer = z.infer<typeof HazardLayerSchema>

// combat.tex "Positioning and Visibility": what a cell does to what crosses
// it. A blocking cell is cover and, unless transparent, breaks vision;
// difficult terrain asks for a Balance test (combat.tex "Balance"); the
// visibility is what the terrain grants whoever stands in it; a suffocating
// cell is gas the map was drawn with (combat.tex "Gas": "anyone that is
// inside a suffocating gas is suffocating"). What actions leave on it comes
// in `layers`.
export const TerrainCellSchema = z.object({
  blocking: z.boolean().default(false),
  transparent: z.boolean().default(false),
  difficult: z.boolean().default(false),
  liquid: z.boolean().default(false),
  elevation: num.default(0),
  visibility: VisibilitySchema.default('good'),
  suffocating: z.boolean().default(false),
  // combat.tex "Balance": the DL of the difficult terrain test, "based on how
  // slippery, unstable, long, and narrow the path is" — the table's call
  DL: num.default(5),
  layers: z.array(HazardLayerSchema).default([]),
}).strip()

// The spatial facts of a fight, in game units. The real grid is a VTT's; this
// is what the domain needs of it to judge distance, reach, cover and where a
// move may end. `placements` is keyed by character id, `terrain` by the cell
// key `geometry.ts` makes of a Coord, and a cell absent from `terrain` is
// open ground.
export const BoardSchema = z.object({
  placements: z.record(z.string(), PlacementSchema).default({}),
  terrain: z.record(z.string(), TerrainCellSchema).default({}),
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
  step: z.enum(['define', 'react', 'post', 'done']).default('define'),
  // An action another opened that its actor chose not to take: closed
  // without landing, and kept so it is not offered again.
  declined: z.boolean().default(false),
  cost: ActionCostSchema.nullable().default(null),
  roll: ActionRollSchema.nullable().default(null),
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

// An attack as declared before the die: the row, the variation it is made
// as, and where it is aimed — the kind of place, and the target's part there
// when one was picked (combat.tex "Localized damage").
const AttackDeclaration = {
  ...WeaponRowRef,
  variant: str.default(''),
  location: HitLocationSchema.default('chest'),
  part: str.nullable().default(null),
}

// combat.tex "Sweeping Attack": "Decide whether to attack from right to left
// or vice versa" — the way the arc turns from the target, declared with a
// sweeping variation by whoever strikes: a strike, or the opportunity attack
// or counterattack that opens one.
const SweepDeclaration = {
  sweepDirection: z.enum(['clockwise', 'counterclockwise']).default('clockwise'),
}

// combat.tex "Grapple": two characters locked together, and which of them
// hold the other — a hold both ways is a grab answered by "grapple back". A
// holder keeps the hold only while they have a grapple row to hold with.
// Who a maneuver left immobile stays so while the grapple lasts. Each holder
// holds with one weapon the grapple seized (`weapons`, holder id to wielded
// key), which serves this grapple alone, the table's ruling. It is a fact
// of the fight, not of either character, so it lives on the fight.
export const GrappleSchema = z.object({
  members: z.tuple([str, str]),
  holders: z.array(str).default([]),
  immobile: z.array(str).default([]),
  weapons: z.record(str, str).default({}),
}).strip()
export type Grapple = z.infer<typeof GrappleSchema>

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
  dropped: z.object({ ownerId: str, itemId: str }).nullable().default(null),
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
  ...AttackDeclaration,
  // combat.tex "Opportunity Attack": "the defense takes -2 penalty unless
  // it's the SD"
  opportunity: z.boolean().default(false),
  facts: DeliverySchema.nullable().default(null),
  // what landing did to the target's action, written at the resolve: a move
  // an opportunity attack interrupted is cut short by it
  interruption: InterruptionSchema.default('none'),
  // combat.tex "Braced Attack": a hit "trigger[s] a trample" — the mover
  // against the bracer, written at the resolve
  trample: TrampleSchema.nullable().default(null),
  // combat.tex "Initiate the Grab": made with a grapple row, a hit grapples
  // the target; what it came to is written at the resolve
  grab: z.boolean().default(false),
  grabbed: GrappleFactsSchema.nullable().default(null),
  // combat.tex "Catch": a grab made at a running target, "3AP+1STA", whose
  // hit is a crash the catcher gets +3 in
  catch: z.boolean().default(false),
  // combat.tex "Evasive Jump": where the target's jump landed them, written
  // at the resolve
  jumpedTo: PlacementSchema.nullable().default(null),
  ...SweepDeclaration,
  // combat.tex "Sweeping Attack": who the sweep still reaches after this
  // target, in order, written on a board when it is committed or opened;
  // and what is left of the blow when it comes to this target (combat.tex
  // "Damage absorption"), 1 for the first. Each target after the first is
  // a strike of its own, opened by the one before it, naming the sweep's
  // first strike in `sweepOf` (null on the first, and on any other strike).
  arc: z.array(str).default([]),
  sweepOf: str.nullable().default(null),
  share: num.default(1),
}).strip()

// combat.tex "Accuracy", "Shoot": a ranged weapon attack, "a throw or shot
// directed at a target ... against the opponent's reflexes or their SD". The
// way of shooting (combat.tex "Shoot", "Snipe", "Quick Shot") is the
// variation, declared before the roll along with the location.
export const ShootActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('shoot'),
  ...AttackDeclaration,
  facts: DeliverySchema.nullable().default(null),
  // what landing did to the target's action, written at the resolve: an
  // evader "interrupted" gets no move after the shot (combat.tex "Evasion")
  interruption: InterruptionSchema.default('none'),
  // combat.tex "Throw": what left the hand, one of it, to land where the
  // throw was aimed; written at the resolve, null for a shot
  thrown: ItemSchema.nullable().default(null),
  // gear.tex "Quiver": the stack of arrows or bolts the shot is loaded
  // from, declared with the row; '' for a row that loads nothing
  ammoId: str.default(''),
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
  // improvement -> times bought
  improved: z.partialRecord(SpellModificationSchema, num).default({}),
  // spells.tex "Casting spells": the graze was bought up to a hit for 2 AP
  grazeSaved: z.boolean().default(false),
  // a hit that did nothing, written when it lands: short of the
  // amplifications or the range its HOP had to buy
  failed: z.boolean().default(false),
  facts: DeliveriesSchema.nullable().default(null),
}).strip()

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
export const BlockActionSchema = z.object({ ...ActionBase, kind: z.literal('block'), ...WeaponRowRef, ...GuardStep }).strip()
export const InterceptActionSchema = z.object({ ...ActionBase, kind: z.literal('intercept'), ...WeaponRowRef, ...GuardStep, advance: z.boolean().default(false) }).strip()

// combat.tex "Reflex": the two reactions to a shot. Evasion is the reflex
// test; where it lets the evader move, the move is opened after the shot,
// unless the evader declared they `stay` where they are (abilities.tex
// "Precise Reflexes": "uses reflexes without moving"). A guard names the
// DEF row it is made with, and may be made by the target or by someone
// adjacent standing nearer the shooter.
export const EvasionActionSchema = z.object({ ...ActionBase, kind: z.literal('evasion'), stay: z.boolean().default(false) }).strip()
export const GuardActionSchema = z.object({ ...ActionBase, kind: z.literal('guard'), ...WeaponRowRef }).strip()

// combat.tex "Avoiding an Explosion": the reaction to an explosion, a reflex
// test of the reactor's own against the explosion's DL. The die is on the
// reaction's `roll`, thrown with the root's; what its degree lets the
// reactor do is a move opened before or after the blast.
export const AvoidExplosionActionSchema = z.object({ ...ActionBase, kind: z.literal('avoidExplosion') }).strip()

// Where a move actually ended and why: the path as walked, cut short by a
// reaction that interrupted it, by the mover's own jump
// away from one (a movement of its own, which takes over), by a fall on
// difficult terrain, or by someone fleeing it.
export const MoveStopSchema = z.enum(['end', 'reaction', 'jump', 'fall', 'trample', 'flee'])
export type MoveStop = z.infer<typeof MoveStopSchema>

export const MoveFactsSchema = z.object({
  path: z.array(CoordSchema).default([]),
  stop: MoveStopSchema.default('end'),
  fell: z.boolean().default(false),
  trampled: z.array(TrampleSchema).default([]),
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
  ...AttackDeclaration,
  ...SweepDeclaration,
  grab: z.boolean().default(false),
  // combat.tex "Grapple Maneuvers": "can be used like opportunity attacks"
  // — against a grapple partner, what is opened is a maneuver instead of a
  // strike
  mode: z.enum(['strike', 'grapple']).default('strike'),
  maneuver: GrappleManeuverSchema.default('immobilize'),
}).strip()

// combat.tex "Coordinated Shots": a shot at the target of one being made,
// declared in full as a reaction to it — the row, the way of shooting, where
// it aims and what it is loaded with — and opened as a shot of its own before
// the shot it joins lands. It is aimed at the target of that shot.
export const JoinShotActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('joinShot'),
  ...AttackDeclaration,
  ammoId: str.default(''),
}).strip()

// abilities.tex "Counterattack": the target's answer to a strike, declared
// with the strike it opens in full. Its die is thrown with the attack's, and
// the two results say which of them lands first (rules/counter.ts).
export const CounterattackActionSchema = z.object({ ...ActionBase, kind: z.literal('counterattack'), ...AttackDeclaration, ...SweepDeclaration }).strip()

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
// opportunity attack. `hook` is the knockdown a hook
// attack opens (combat.tex "Hook Attack"): free, needing no grapple, and
// with no throwing oneself along ("Knockdown").
export const GrappleActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('grapple'),
  maneuver: GrappleManeuverSchema.default('escape'),
  along: z.boolean().default(false),
  item: str.default(''),
  unresisted: z.boolean().default(false),
  opportunity: z.boolean().default(false),
  hook: z.boolean().default(false),
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
const TermSchema = z.object({ label: str, value: num }).strip()
export const PushMovementSchema = z.enum(PUSH_MOVEMENTS)
export type PushMovement = z.infer<typeof PushMovementSchema>
export const DragActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('drag'),
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

// combat.tex "Rest": "an action that costs 4 AP and recovers STA by an
// amount equal to STA/4".
export const RestActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('rest'),
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
  SpellTestActionSchema,
  EvasionActionSchema,
  GuardActionSchema,
  AvoidExplosionActionSchema,
  EvadeActionSchema,
  BraceActionSchema,
  EvasiveJumpActionSchema,
  BlockActionSchema,
  InterceptActionSchema,
  OpportunityAttackActionSchema,
  JoinShotActionSchema,
  CounterattackActionSchema,
  FollowActionSchema,
  FleeActionSchema,
  FleeFollowUpActionSchema,
  MoveActionSchema,
  GrappleActionSchema,
  DragActionSchema,
  ReleaseActionSchema,
  HoldBackActionSchema,
  PickUpActionSchema,
  ThrowActionSchema,
  RestActionSchema,
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
export type SpellTestAction = z.infer<typeof SpellTestActionSchema>
export type MoveAction = z.infer<typeof MoveActionSchema>
export type GrappleAction = z.infer<typeof GrappleActionSchema>
export type DragAction = z.infer<typeof DragActionSchema>
export type ReleaseAction = z.infer<typeof ReleaseActionSchema>
export type HoldBackAction = z.infer<typeof HoldBackActionSchema>
export type ActionOf<K extends ActionKind> = Extract<Action, { kind: K }>
// What an opportunity attack opens: a strike, or against a grapple partner a
// maneuver (combat.tex "Grapple Maneuvers").
export type OpportunityAction = StrikeAction | GrappleAction
export type PickUpAction = z.infer<typeof PickUpActionSchema>
export type ThrowAction = z.infer<typeof ThrowActionSchema>
export type RestAction = z.infer<typeof RestActionSchema>
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

// A contest for the turn as it was rolled: each contender's cunning roll, in
// the order they asked, the holder first, and who took the turn.
export const ContestRollSchema = z.object({ id: z.string(), die: z.number(), skill: z.number(), score: z.number() })
export const ContestSchema = z.object({ rolls: z.array(ContestRollSchema), winner: z.string() })
export type ContestRoll = z.infer<typeof ContestRollSchema>

// A turn waiting to be taken: whose, whether it is a flee, and — for one
// that was interrupted — how long the log was when it first started, so it
// resumes as the turn it was
export const QueuedTurnSchema = z.object({ id: z.string(), fleeing: z.boolean().default(false), startedAt: z.number().nullable().default(null) })
export type QueuedTurn = z.infer<typeof QueuedTurnSchema>
export type Contest = z.infer<typeof ContestSchema>

// The shape of a fight. This lives in the domain — not in the Zustand store —
// so the combat commands can be pure `(state) => state` updaters with no
// dependency on the state layer. The store composes this with its actions.
//
// It is a schema rather than a plain type because a combat is persistable:
// the same parse-with-defaults path that ingests characters can rehydrate a
// saved fight, and every field carries a default so a partial or older payload
// still lands on a complete CombatState.
export const CombatStateSchema = z.object({
  characters: z.record(z.string(), CampaignCharacterSchema).default({}),
  activeCharacterId: z.string().nullable().default(null),
  round: z.number().default(0),
  // play.tex "Combat": whose turn it is, '' for nobody's, and how long the
  // action log was when it started — the turn can be contested until
  // something is declared in it
  inTurnCharacter: z.string().default(''),
  turnStartedAt: z.number().default(0),
  // who has asked to contest the turn, in the order they asked, and the
  // contest once it is rolled — a turn is contested once
  contenders: z.array(z.string()).default([]),
  lastContest: ContestSchema.nullable().default(null),
  // combat.tex "Flee": whether the turn being taken is a flee, and the turns
  // waiting on it, the next first — each fleer's, then the turn the flee
  // interrupted, resumed where it was ("which is resumed after the flee")
  fleeing: z.boolean().default(false),
  turnQueue: z.array(QueuedTurnSchema).default([]),
  // the characters whose flee is due once what is being played out is
  // done, in the order they declared it
  fleers: z.array(z.string()).default([]),
  // Every action of the fight in the order it was declared, resolved ones
  // included: the open one is the last root still short of resolved, and the
  // rest is the fight's history.
  actions: z.array(ActionSchema).default([]),
  // The actions still being played out, by id, the one the table is waiting
  // on last. An action a reaction opens is pushed over the one it answers
  // and played out first; an action leaves when it resolves.
  stack: z.array(z.string()).default([]),
  // The actions that have been played out, by id, in the order they landed —
  // which is not the order they were declared in: an opportunity attack
  // lands before the action it answers.
  history: z.array(z.string()).default([]),
  // Null is a fight with no grid: every positional gate passes, and the
  // fight is played as it was before there was a board.
  board: BoardSchema.nullable().default(null),
  // combat.tex "Grapple": every grapple of the fight, one per pair
  grapples: z.array(GrappleSchema).default([]),
  floor: z.array(FloorItemSchema).default([]),
}).strip()

export type CombatState = z.infer<typeof CombatStateSchema>

// What every combat command is: a pure update of the fight.
export type Updater = (state: CombatState) => CombatState
