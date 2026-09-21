import { z } from 'zod'
import { CampaignCharacterSchema, MovementKindSchema, WeaponPropertySchema } from '../types'
import { HIT_LOCATIONS, HOP_PURCHASES } from '../lists'

const num = z.number()
const str = z.string()

// play.tex "Degrees of success", as an attack sees them: there is no critical
// on an attack, everything past a hit is HOP (play.tex "Hit Overflow Point").
export const DEGREES = ['miss', 'graze', 'hit'] as const
export const DegreeSchema = z.enum(DEGREES)
export type Degree = z.infer<typeof DegreeSchema>

export const HitLocationSchema = z.enum(HIT_LOCATIONS)
export type HitLocation = z.infer<typeof HitLocationSchema>

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

// An action is data: what a character is attempting, against whom, what was
// declared before the die, and what the die said. Nothing here is a
// procedure — the character reducer reads an action and applies the part of
// it that concerns that character. It is stored, so it is a schema.
//
// `status` is the three-phase clock the commands enforce: declared (free to
// edit or cancel), rolled (the die is thrown and the price is paid, in the
// same step, with no way back), resolved (the consequences have landed).
// `cost` is written at the roll, off the actor as they were then, so the
// record says what was paid without a lens having to recompute it later.
const ActionBase = {
  id: str,
  actorId: str,
  targetId: str.nullable().default(null),
  // The action this one answers (combat.tex "Reactions"); null for an action
  // taken on the actor's own initiative.
  reactionTo: str.nullable().default(null),
  status: z.enum(['declared', 'rolled', 'resolved']).default('declared'),
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

// combat.tex "Defend": how the target met the attack, none being the SD.
export const DefenseKindSchema = z.enum(['none', 'evade', 'evasiveJump', 'block', 'intercept'])
export type DefenseKind = z.infer<typeof DefenseKindSchema>

// The attacker's side of a strike, final: everything the target needs to
// turn the attack into an injury without looking back at the attacker. It is
// written when the strike resolves, once the HOP are spent, and the target's
// reducer reads only this. The defense is on it because what a block or an
// intercept does to the damage is the attacker's number to carry.
export const StrikeFactsSchema = z.object({
  blunt: num.default(0),
  cut: num.default(0),
  hardness: num.default(0),
  force: num.default(0),
  properties: z.array(WeaponPropertySchema).default([]),
  location: HitLocationSchema.default('chest'),
  degree: DegreeSchema.default('miss'),
  defense: DefenseKindSchema.default('none'),
  // the AP the defender spent on the reaction
  defenseAP: num.default(0),
  // what the defender blocked or intercepted with, by the target's own
  // wielded key: names the hand a wound lands on
  defenseWeaponKey: str.default(''),
  block: num.default(0), // gear.tex "DEF": what the blocking object absorbs
  shield: z.boolean().default(false),
  bypass: z.boolean().default(false),
  penetrating: z.boolean().default(false),
  smash: z.boolean().default(false),
}).strip()
export type StrikeFacts = z.infer<typeof StrikeFactsSchema>

// combat.tex "Strike": a melee weapon attack; the variation and the location
// are declared before the roll (combat.tex "Melee Combat", "Localized damage").
export const StrikeActionSchema = z.object({
  ...ActionBase,
  kind: z.literal('strike'),
  ...WeaponRowRef,
  variant: str.default(''),
  location: HitLocationSchema.default('chest'),
  facts: StrikeFactsSchema.nullable().default(null),
}).strip()

// combat.tex "Defend": the four active defenses, each a reaction to a strike.
export const EvadeActionSchema = z.object({ ...ActionBase, kind: z.literal('evade') }).strip()
export const EvasiveJumpActionSchema = z.object({ ...ActionBase, kind: z.literal('evasiveJump') }).strip()
export const BlockActionSchema = z.object({ ...ActionBase, kind: z.literal('block'), ...WeaponRowRef }).strip()
export const InterceptActionSchema = z.object({ ...ActionBase, kind: z.literal('intercept'), ...WeaponRowRef }).strip()

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
// visibility is what the terrain grants whoever stands in it.
export const VisibilitySchema = z.enum(['good', 'bad', 'zero'])
export type Visibility = z.infer<typeof VisibilitySchema>

export const TerrainCellSchema = z.object({
  blocking: z.boolean().default(false),
  transparent: z.boolean().default(false),
  difficult: z.boolean().default(false),
  liquid: z.boolean().default(false),
  elevation: num.default(0),
  visibility: VisibilitySchema.default('good'),
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
}).strip()
export type Board = z.infer<typeof BoardSchema>

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
}).strip()

export const ActionSchema = z.discriminatedUnion('kind', [
  StrikeActionSchema,
  EvadeActionSchema,
  EvasiveJumpActionSchema,
  BlockActionSchema,
  InterceptActionSchema,
  MoveActionSchema,
])

export type Action = z.infer<typeof ActionSchema>
export type ActionKind = Action['kind']
export type StrikeAction = z.infer<typeof StrikeActionSchema>
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
