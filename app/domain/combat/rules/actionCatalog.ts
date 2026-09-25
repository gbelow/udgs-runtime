import type { ActionKind as PricedAction } from '../../tables'
import type { ActionDraft, ActionKind } from '../types'

// What kind of thing each action is. `type` is combat.tex "Reactions": a
// reaction is taken on someone else's turn and only in answer to one of the
// kinds it `reactsTo`. `price` names the row of ACTION_COSTS that is its
// whole cost; null where the price is the declaration's to say (a strike
// costs what its weapon row and variation cost).
export type ActionDef<K extends ActionKind = ActionKind> = {
  label: string
  type: 'action' | 'reaction'
  price: PricedAction | null
  reactsTo: readonly ActionKind[]
  // whether a die commits the action; one without is committed by paying.
  // A move is the exception `needsDie` makes: difficult terrain
  // puts a Balance test on it. On a reaction, whether it is a test of its
  // own, thrown with the root's die.
  die: boolean
  // combat.tex "Opportunity Attack": one of the actions whose opportunity
  // attacks are fought before its effect lands, and which one can cancel —
  // a move's are fought along its path instead (rules/move.ts), and a
  // strike draws only a flanker's, fought after it
  triggering?: true
  // whether the declaration is aimed at someone the actor picks; a cast
  // only when its spell has an effect for a target (rules/cast.ts
  // `isTargeted`)
  targeted?: true
  // the declared fields that tell two options of the kind apart, each with
  // the value it reads as when left out
  identity?: Partial<Omit<Extract<ActionDraft, { kind: K }>, 'kind'>>
}

export const ACTIONS = {
  // combat.tex "Strike"
  strike:      { label: 'strike',       type: 'action',   price: null,          reactsTo: [],         die: true, targeted: true, identity: { grab: false } },
  // combat.tex "Accuracy", "Shoot"
  shoot:       { label: 'shoot',        type: 'action',   price: null,          reactsTo: [],         die: true, triggering: true, targeted: true },
  // combat.tex "Explosions": no test of the attacker's — "the DL of the
  // explosion is equal to the shooting skill", and it is the reactors who roll
  explosion:   { label: 'explosion',    type: 'action',   price: null,          reactsTo: [],         die: false, triggering: true, identity: { source: 'thrown' } },
  // spells.tex "Casting spells": the caster's test against the spell's DL
  cast:        { label: 'cast',         type: 'action',   price: null,          reactsTo: [],         die: true, triggering: true, targeted: true },
  // combat.tex "Movement"
  move:        { label: 'move',         type: 'action',   price: null,          reactsTo: [],         die: false },
  // combat.tex "Defend": "There are four types of defense: Evade, Evasive
  // Jump, Intercept, and Block." "Evade: ... This can be used to avoid
  // being trampled" — a move whose path comes into the evader.
  evade:       { label: 'evade',        type: 'reaction', price: 'evade',       reactsTo: ['strike', 'move'], die: false },
  evasiveJump: { label: 'evasive jump', type: 'reaction', price: 'evasiveJump', reactsTo: ['strike'], die: false },
  block:       { label: 'block',        type: 'reaction', price: 'block',       reactsTo: ['strike'], die: false, identity: { weaponKey: '', attack: '' } },
  intercept:   { label: 'intercept',    type: 'reaction', price: 'intercept',   reactsTo: ['strike'], die: false, identity: { weaponKey: '', attack: '' } },
  // combat.tex "Reflex": "Evasion" and "Guard", the two reactions to a shot
  evasion:     { label: 'evasion',      type: 'reaction', price: 'reflex',      reactsTo: ['shoot'],  die: false, identity: { stay: false } },
  guard:       { label: 'guard',        type: 'reaction', price: 'guard',       reactsTo: ['shoot'],  die: false, identity: { weaponKey: '', attack: '' } },
  // combat.tex "Avoiding an Explosion": "Spend 3 AP and make a reflex skill
  // test against the DL of the explosion"
  avoidExplosion: { label: 'avoid explosion', type: 'reaction', price: 'avoidExplosion', reactsTo: ['explosion'], die: true },
  // combat.tex "Opportunity Attack", "Flanking", "Follow": priced by the
  // action each opens when the root resolves
  opportunityAttack: { label: 'opportunity attack', type: 'reaction', price: null, reactsTo: ['strike', 'move'], die: false, identity: { at: null } },
  follow:      { label: 'follow',       type: 'reaction', price: null,          reactsTo: ['move'],   die: false },
  // combat.tex "Grapple Maneuvers": a grapple test against the partner's
  grapple:     { label: 'grapple',      type: 'action',   price: 'grappleManeuver', reactsTo: [],     die: true, triggering: true, targeted: true, identity: { maneuver: 'escape', stand: false } },
  // combat.tex "Push and drag": "a force vs force comparison", no die
  drag:        { label: 'push or drag', type: 'action',   price: 'pushDrag',    reactsTo: [],         die: false, triggering: true, targeted: true },
  // letting go of a partner who does not hold back costs nothing
  release:     { label: 'let go',       type: 'action',   price: null,          reactsTo: [],         die: false, targeted: true },
  // combat.tex "Initiate the Grab": "It is possible to grapple back
  // automatically just by having a weapon with grappling property
  // equipped" — one who takes one up mid-grapple does so as a free action
  holdBack:    { label: 'grapple back', type: 'action',   price: null,          reactsTo: [],         die: false, targeted: true },
  // combat.tex "Grapple Maneuvers", "Push and drag": the defender's 2 AP +
  // 1 STA that spares them the -5
  resist:      { label: 'resist',       type: 'reaction', price: 'grappleDefense', reactsTo: ['grapple', 'drag'], die: false },
  // combat.tex "Push and drag": everyone else dragged may help the push
  // ("add to the test and spend AP+STA"), go along with it paying the basic
  // movement for the metres, or — held by nobody — let go and stay
  assist:      { label: 'help push',    type: 'reaction', price: 'pushDrag',    reactsTo: ['drag'],   die: false },
  carry:       { label: 'go along',     type: 'reaction', price: null,          reactsTo: ['drag'],   die: false },
  letGo:       { label: 'let go',       type: 'reaction', price: null,          reactsTo: ['drag'],   die: false },
  // combat.tex "Standard Action"
  pickUp:      { label: 'pick up',      type: 'action',   price: 'standardAction', reactsTo: [],      die: false, triggering: true },
} as const satisfies { [K in ActionKind]: ActionDef<K> }

// The flags as the catalog declares them, read through the general shape
// where the kind is not known.
export function getActionDef(kind: ActionKind): ActionDef {
  return ACTIONS[kind]
}

export function isReaction(kind: ActionKind): boolean {
  return ACTIONS[kind].type === 'reaction'
}

export function reactsTo(kind: ActionKind, root: ActionKind): boolean {
  return (ACTIONS[kind].reactsTo as readonly ActionKind[]).includes(root)
}
