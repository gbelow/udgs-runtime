import { z } from 'zod'
import { CampaignCharacterSchema, DegreeSchema, DeliverySchema, HitLocationSchema, InterruptionSchema, MovementKindSchema, VisibilitySchema } from '../types'
import { HOP_PURCHASES } from '../lists'
import { SPELL_MODIFICATIONS } from '../tables'

export { DEGREES, DegreeSchema, HitLocationSchema, DefenseKindSchema, InterruptionSchema, VisibilitySchema } from '../types'
export type { Degree, HitLocation, DefenseKind, Interruption, Visibility } from '../types'

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

// Where a character stands. `cell` is the anchor of its footprint and
// `orientation` one of the six hex rotations the footprint may take
// (creating.tex "Size and Space Occupation"); which cells that covers is the
// footprint lens's to say. `focus` is who the character is looking at, for
// line of sight (combat.tex "Visibility"); it decides nothing yet. It is a
// fact of the fight, not of the character, so it lives here and not on the
// character record.
export const PlacementSchema = z.object({
  cell: CoordSchema.default({ q: 0, r: 0 }),
  orientation: z.number().int().min(0).max(5).default(0),
  elevation: num.default(0), // metres; combat.tex "High Ground"
  focus: str.nullable().default(null),
}).strip()
export type Placement = z.infer<typeof PlacementSchema>

// combat.tex "Positioning and Visibility": what a cell does to what crosses
// it. A blocking cell is cover and, unless transparent, breaks vision;
// difficult terrain asks for a Balance test (combat.tex "Balance"); the
// visibility is what the terrain grants whoever stands in it; a suffocating
// cell is gas (combat.tex "Gas": "anyone that starts the round inside a
// suffocating gas is suffocating").
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
}).strip()
export type TerrainCell = z.infer<typeof TerrainCellSchema>

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
// `status` is the clock the commands enforce: declared (free to edit or
// cancel), committed (the declaration is locked and its triggers loaded, so
// everyone else may answer it; still free to cancel), rolled (the die is
// thrown and the price is paid, in the same step, with no way back),
// resolved (the consequences have landed).
// `cost` is written at the roll, off the actor as they were then, so the
// record says what was paid without a lens having to recompute it later.
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
  status: z.enum(['declared', 'committed', 'rolled', 'resolved']).default('declared'),
  cost: ActionCostSchema.nullable().default(null),
  roll: ActionRollSchema.nullable().default(null),
  // HOP purchase -> times bought
  spent: z.partialRecord(HOPPurchaseSchema, num).default({}),
}

// A weapon row is named the way the hands name it: the wielded key (an item id
// or `natural:<name>`) and the attack row's name. Empty strings are the
// declaration still to be made.
const WeaponRowRef = {
  weaponKey: str.default(''),
  attack: str.default(''),
}

// The attacker's side of a strike or a shot, final: what the attack
// delivers to its target, written when the attack resolves, once the HOP are
// spent, with the degree the test came to. The target's reducer reads only
// this.
export const StrikeActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('strike'),
  ...WeaponRowRef,
  variant: str.default(''),
  location: HitLocationSchema.default('chest'),
  // combat.tex "Opportunity Attack": "the defense takes -2 penalty unless
  // it's the SD"
  opportunity: z.boolean().default(false),
  facts: DeliverySchema.nullable().default(null),
  // what landing did to the target's action, written at the resolve: a move
  // an opportunity attack interrupted is cut short by it
  interruption: InterruptionSchema.default('none'),
}).strip()

// combat.tex "Accuracy", "Shoot": a ranged weapon attack, "a throw or shot
// directed at a target ... against the opponent's reflexes or their SD". The
// way of shooting (combat.tex "Shoot", "Snipe", "Quick Shot") is the
// variation, declared before the roll along with the location.
export const ShootActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('shoot'),
  ...WeaponRowRef,
  variant: str.default(''),
  location: HitLocationSchema.default('chest'),
  facts: DeliverySchema.nullable().default(null),
  // what landing did to the target's action, written at the resolve: an
  // evader "interrupted" gets no move after the shot (combat.tex "Evasion")
  interruption: InterruptionSchema.default('none'),
}).strip()

// combat.tex "Explosions", "Sprays"; gear.tex "Explosion": a ranged attack
// with an area, made with an exploding row. It is aimed at ground, not at a
// character: a disk at the `center` it lands on, picked before the commit;
// a cone from the attacker in a `direction` picked once the reactions have
// moved ("The attacker can choose the exact direction of the cone after the
// movement"). Whoever stands in the area when it resolves is in `facts`,
// each with what reaches them at their zone's degree, one delivery per
// effect of the payload that reaches them.
export const ExplosionFactsSchema = z.record(z.string(), z.array(DeliverySchema))
export type ExplosionFacts = z.infer<typeof ExplosionFactsSchema>

// Where an explosion comes from decides its test: thrown, the reflex is
// against the thrower's Accuracy; cast, against what the spell's effects
// say; set off — a charge or a trap going off where nobody could react —
// there is none (the table's ruling: the test was spotting it). `key` is
// the spell whose effects go off for a cast; a thrown item's and a
// detonation's is the charge the object carries, and `itemId` names that
// object — a charge is set off in something, wherever that something is.
export const ExplosionActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('explosion'),
  source: z.enum(['thrown', 'cast', 'detonate']).default('thrown'),
  ...WeaponRowRef,
  variant: str.default(''),
  key: str.default(''),
  itemId: str.default(''),
  center: CoordSchema.nullable().default(null),
  direction: z.number().int().min(0).max(5).nullable().default(null),
  facts: ExplosionFactsSchema.nullable().default(null),
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
  // spells.tex "Quicken Spell": +4 DL to cast without the focus surge
  quicken: z.boolean().default(false),
  // improvement -> times bought
  improved: z.partialRecord(SpellModificationSchema, num).default({}),
  // spells.tex "Casting spells": the graze was bought up to a hit for 2 AP
  grazeSaved: z.boolean().default(false),
  // spells.tex "Concentration": given up to answer an opportunity attack it
  // drew with an active defense instead of the SD, or lost outright once one
  // of them interrupts — either way nothing the cast would have produced
  // lands, though the AP/STA already spent stays spent.
  cancelled: z.boolean().default(false),
  facts: z.record(z.string(), z.array(DeliverySchema)).nullable().default(null),
}).strip()

// combat.tex "Defend": the four active defenses, each a reaction to a strike.
export const EvadeActionSchema = z.object({ ...ActionBase, kind: z.literal('evade') }).strip()
// An evasive jump names where it lands (combat.tex "Evasive Jump": "jump
// away from the attack"); null on a fight without a board.
export const EvasiveJumpActionSchema = z.object({ ...ActionBase, kind: z.literal('evasiveJump'), to: PlacementSchema.nullable().default(null) }).strip()
export const BlockActionSchema = z.object({ ...ActionBase, kind: z.literal('block'), ...WeaponRowRef }).strip()
export const InterceptActionSchema = z.object({ ...ActionBase, kind: z.literal('intercept'), ...WeaponRowRef }).strip()

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
// turn at a run, by a reaction that interrupted it, by the mover's own jump
// away from one (a movement of its own, which takes over), or by a fall on
// difficult terrain.
export const MoveStopSchema = z.enum(['end', 'turn', 'reaction', 'jump', 'fall'])
export type MoveStop = z.infer<typeof MoveStopSchema>

export const MoveFactsSchema = z.object({
  path: z.array(CoordSchema).default([]),
  stop: MoveStopSchema.default('end'),
  fell: z.boolean().default(false),
}).strip()
export type MoveFacts = z.infer<typeof MoveFactsSchema>

// combat.tex "Movement": a move is a path of anchor cells, each a step from
// the last, taken at one kind of movement, ending in any orientation (null
// keeps the current one). It has no target and no die: it is committed by
// paying for it.
export const MoveActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('move'),
  movement: MovementKindSchema.default('basic'),
  path: z.array(CoordSchema).default([]),
  orientation: z.number().int().min(0).max(5).nullable().default(null),
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
  // what the reaction asks on top of the path for one of `surchargedMovements`
  // (combat.tex "Avoiding an Explosion": "can run by spending one extra
  // STA") — nothing extra for falling back to a kind not in that list
  surcharge: ActionCostSchema.default({ AP: 0, STA: 0 }),
  surchargedMovements: z.array(MovementKindSchema).default([]),
  // where the mover set out from, written at the commit: the path is read
  // from here even once an opportunity attack has the mover standing part
  // of the way along it
  from: PlacementSchema.nullable().default(null),
  facts: MoveFactsSchema.nullable().default(null),
}).strip()

// combat.tex "Opportunity Attack" and "Flanking": declared as a reaction to
// a strike (by a flanker), a move (by whoever the mover comes at), or a
// cast (by anyone who threatens the caster — spells.tex "Concentration"
// makes casting a triggering action), and opens a strike of its own — after
// the strike it answers resolves, or before the move or the cast it answers
// does ("The attack occurs before the effect of the triggering action"). The
// strike is declared here, in full, before the root is paid for: what it
// opens is already committed. `at` is the path step of a move at which it
// fired; the mover stands one space short of that stretch while it is
// fought, and stays there if it interrupts.
export const OpportunityAttackActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('opportunityAttack'),
  at: num.nullable().default(null),
  ...WeaponRowRef,
  variant: str.default(''),
  location: HitLocationSchema.default('chest'),
}).strip()

// combat.tex "Follow": a reaction to a move by someone in melee range; when
// the root resolves it opens a move of the follower's own, capped at what
// the triggering move cost.
export const FollowActionSchema = z.object({ ...ActionBase, kind: z.literal('follow') }).strip()

export const ActionSchema = z.discriminatedUnion('kind', [
  StrikeActionSchema,
  ShootActionSchema,
  ExplosionActionSchema,
  CastActionSchema,
  EvasionActionSchema,
  GuardActionSchema,
  AvoidExplosionActionSchema,
  EvadeActionSchema,
  EvasiveJumpActionSchema,
  BlockActionSchema,
  InterceptActionSchema,
  OpportunityAttackActionSchema,
  FollowActionSchema,
  MoveActionSchema,
])

export type Action = z.infer<typeof ActionSchema>
export type ActionKind = Action['kind']
export type StrikeAction = z.infer<typeof StrikeActionSchema>
export type ShootAction = z.infer<typeof ShootActionSchema>
// The two weapon attacks: what is rolled against a defense and lands as an
// injury, declared as a weapon row, a variation and a location.
export type AttackAction = StrikeAction | ShootAction
export type ExplosionAction = z.infer<typeof ExplosionActionSchema>
export type CastAction = z.infer<typeof CastActionSchema>
// Everything made with a weapon row: the two attacks and an explosion.
export type WeaponAction = AttackAction | ExplosionAction
export type MoveAction = z.infer<typeof MoveActionSchema>
export type ActionOf<K extends ActionKind> = Extract<Action, { kind: K }>

// The declaration a click makes: an action minus everything the commands fill
// in (identity, status, the roll, the facts). What is left is the kind and its
// own declared fields, each optional so a bare kind can be declared and
// completed step by step.
export type ActionDraft = {
  [K in ActionKind]: { kind: K } & Partial<Omit<ActionOf<K>, keyof typeof ActionBase | 'kind' | 'facts'>>
}[ActionKind]

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
  inTurnCharacter: z.string().default(''),
  // Every action of the fight in the order it was declared, resolved ones
  // included: the open one is the last root still short of resolved, and the
  // rest is the fight's history.
  actions: z.array(ActionSchema).default([]),
  // Null is a fight with no grid: every positional gate passes, and the
  // fight is played as it was before there was a board.
  board: BoardSchema.nullable().default(null),
}).strip()

export type CombatState = z.infer<typeof CombatStateSchema>
