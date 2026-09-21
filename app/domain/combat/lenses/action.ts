import type { AttackKind, CampaignCharacter, Character, Weapon, WeaponAttack } from '../../types'
import { ActionSchema, type Action, type ActionDraft, type ActionKind, type ActionOf, type AttackAction, type CombatState, type Degree, type HitLocation, type StrikeAction, type WeaponAction } from '../types'
import { ACTIONS, reactsTo } from '../actionCatalog'
import { LOCATIONS } from '../../tables'
import { HIT_LOCATIONS } from '../../lists'
import { getWieldedWeapons, isAttackUsable, Wielded } from '../../item/lenses/hands'
import { AttackVariant, getAttacksList, getShotKind, isWieldable, needsFocus } from '../../character/lenses/gear'
import { getAccuracy, getDefend, getReflex, getSD, getStrike } from '../../character/lenses/skills'
import { getAGI } from '../../character/lenses/characteristics'
import { getAfflictions } from '../../character/lenses/afflictions'
import { getBuffBonus } from '../../character/lenses/effects'
import { ActionCost, getActionCost } from '../../character/lenses/actionCosts'
import { Term, sumTerms } from '../../character/lenses/terms'
import { getAttackKind, hasProperty } from '../../weaponProperties'
import { isHighGround, isInReach, isInShotRange } from './board'
import { getMovePrice, getMoveWaypoint, getMovementOptions, hasJumpSpace, isMidJump, isPathLegal, needsBalanceTest } from './move'
import { getAffected, getExplosionArea, getExplosionDLTerms, isAimed } from './explosion'
import { getTriggersFor } from './reactions'

// ---------------------------------------------------------------------------
// Finding actions in the fight

// The action being played out: the first root not yet resolved. Nothing can
// be declared while one is open, so there is only ever one — except for the
// actions a reaction opens (an opportunity attack, a follow), which are
// played out ahead of whatever they were opened against: an opportunity
// attack on a mover is fought while the move waits to resolve.
export function getOpenAction(state: CombatState): Action | null {
  const roots = state.actions.filter((a) => a.reactionTo === null && a.status !== 'resolved')
  return roots.find((a) => a.spawnedBy !== null) ?? roots[0] ?? null
}

// Whether the action is closed by a die: a strike always, a move when it
// crosses difficult terrain (combat.tex "Balance"), an explosion when a
// reaction declared against it is a test of its own (combat.tex "Avoiding
// an Explosion").
export function needsDie(state: CombatState, action: Action): boolean {
  if (action.kind === 'move') return needsBalanceTest(state, action)
  return ACTIONS[action.kind].die || getReactionsTo(state, action.id).some((r) => ACTIONS[r.kind].die)
}

export function getReactionsTo(state: CombatState, id: string): Action[] {
  return state.actions.filter((a) => a.reactionTo === id)
}

export function getAction(state: CombatState, id: string): Action | null {
  return state.actions.find((a) => a.id === id) ?? null
}

// ---------------------------------------------------------------------------
// Weapon rows named by an action

export type WeaponRow = { wielded: Wielded; weapon: Weapon; atk: WeaponAttack }

export function findWeaponRow(c: Character, weaponKey: string, attack: string): WeaponRow | null {
  const wielded = getWieldedWeapons(c).find((w) => w.key === weaponKey)
  if (!wielded) return null
  const atk = wielded.weapon.attacks.find((a) => a.name === attack)
  return atk ? { wielded, weapon: wielded.weapon, atk } : null
}

// gear.tex "Size Scaling", "Small/One/Two hands": a row the character can fire
// right now.
function isRowUsable(c: Character, row: WeaponRow): boolean {
  return isWieldable(row.weapon, c) && isAttackUsable(row.atk.handed, row.wielded.grip)
}

// gear.tex "Explosion": a row that "resolves like an explosion" — it has
// the property and somewhere to reach.
function explodes(atk: WeaponAttack): boolean {
  return hasProperty(atk.properties, 'explosion') && atk.area !== undefined
}

// The kind of weapon row each action is made with: a strike a melee row
// (combat.tex "Strike"), a shot a shooting one (combat.tex "Shoot"), an
// explosion any ranged row that explodes (combat.tex "Explosions": "If the
// explosion comes from a projectile") — and a row that explodes is fired as
// nothing else.
function rowFits(atk: WeaponAttack, kind: WeaponAction['kind']): boolean {
  const rowKind: AttackKind = getAttackKind(atk.range)
  switch (kind) {
    case 'strike': return rowKind === 'melee'
    case 'shoot': return rowKind === 'shoot' && !explodes(atk)
    case 'explosion': return rowKind !== 'melee' && explodes(atk)
  }
}

// The variation an attack declared, priced against the attacker as they
// stand; null while it names no row of the attack's kind the attacker can
// fire. combat.tex "Focus surge": "required to use ranged attacks".
export function getAttackVariant(c: Character, action: WeaponAction): AttackVariant | null {
  const row = findWeaponRow(c, action.weaponKey, action.attack)
  if (!row || !isRowUsable(c, row) || !rowFits(row.atk, action.kind)) return null
  if (action.kind !== 'strike' && needsFocus(row.atk, c)) return null
  return getAttacksList({ atk: row.atk, weapon: row.weapon })(c).find((v) => v.name === action.variant) ?? null
}

// The strike an opportunity attack opens, as declared on the reaction:
// committed already, since the reaction was, and aimed at whoever it
// answers.
export function getOpportunityStrike(reaction: ActionOf<'opportunityAttack'>, id: string): StrikeAction {
  const { weaponKey, attack, variant, location } = reaction
  return ActionSchema.parse({ kind: 'strike', id, actorId: reaction.actorId, targetId: reaction.targetId, weaponKey, attack, variant, location, opportunity: true, spawnedBy: reaction.id, status: 'committed' }) as StrikeAction
}

// The fight as it will stand when the opportunity attack is fought: against
// a move, with the mover walked one space short of the stretch that fired
// it. Reach is judged from there.
export function getOpportunityState(state: CombatState, reaction: ActionOf<'opportunityAttack'>): CombatState {
  const root = reaction.reactionTo ? getAction(state, reaction.reactionTo) : null
  if (root?.kind !== 'move' || reaction.at === null || !state.board) return state
  const waypoint = getMoveWaypoint(state, root, reaction.at - 1)
  return waypoint ? { ...state, board: { ...state.board, placements: { ...state.board.placements, [root.actorId]: waypoint } } } : state
}

// Whether everything the action needs declared has been, and names things
// its actor can actually use: a strike or a shot a variation of a row in
// hand, an explosion one aimed where it can land, a block or intercept a DEF
// row (gear.tex "DEF"), a guard a shield (combat.tex "Guard": "If using a
// shield"), an opportunity attack a strike that reaches its target from
// where it will be fought.
export function isDeclarationComplete(state: CombatState, c: Character, action: Action): boolean {
  switch (action.kind) {
    case 'strike':
    case 'shoot':
      return getAttackVariant(c, action) !== null
    case 'explosion':
      return getAttackVariant(c, action) !== null && isAimed(state, action)
    case 'move':
      return isPathLegal(state, action)
    case 'block':
    case 'intercept': {
      const row = findWeaponRow(c, action.weaponKey, action.attack)
      return row !== null && hasProperty(row.atk.properties, 'DEF') && isRowUsable(c, row)
    }
    case 'guard': {
      const root = action.reactionTo ? getAction(state, action.reactionTo) : null
      return root !== null && guardRows(state, c, root).some((row) => row.wielded.key === action.weaponKey && row.atk.name === action.attack)
    }
    case 'evasiveJump':
      return action.to !== null || !hasJumpSpace(state, action.actorId, action.targetId ?? '') || !state.board?.placements[action.actorId]
    case 'opportunityAttack': {
      const strike = getOpportunityStrike(action, '')
      return getAttackVariant(c, strike) !== null && isInReach(getOpportunityState(state, action), strike, action.targetId ?? '')
    }
    case 'evade':
    case 'evasion':
    case 'avoidExplosion':
    case 'follow':
      return true
  }
}

// Whether every reaction declared against the action has said all it must:
// an evasive jump has picked where it lands.
export function areReactionsComplete(state: CombatState, root: Action): boolean {
  return getReactionsTo(state, root.id).every((r) => {
    const c = state.characters[r.actorId]
    return !!c && isDeclarationComplete(state, c, r)
  })
}

// Every attack of the kind the character could declare: each usable row of
// that kind of each wielded weapon, at each of its variations. The panel
// renders these as-is.
export type AttackOption = {
  weaponKey: string
  weapon: string
  attack: string
  variant: string
  AP: number
  STA: number
  penalty: number
  blunt: number
  cut: number
  // metres, for a shot; null for a strike
  reach: number | null
}

export function getAttackOptions(c: Character, kind: WeaponAction['kind']): AttackOption[] {
  return getWieldedWeapons(c).flatMap((wielded) =>
    wielded.weapon.attacks.flatMap((atk) => {
      const row = { wielded, weapon: wielded.weapon, atk }
      if (!isRowUsable(c, row) || !rowFits(atk, kind)) return []
      if (kind !== 'strike' && needsFocus(atk, c)) return []
      return getAttacksList({ atk, weapon: wielded.weapon })(c).map((v) => ({
        weaponKey: wielded.key,
        weapon: wielded.weapon.name,
        attack: atk.name,
        variant: v.name,
        AP: v.AP,
        STA: v.STA,
        penalty: v.penalty,
        blunt: v.blunt,
        cut: v.cut,
        reach: v.reach,
      }))
    }),
  )
}

// combat.tex "Focus surge": "required to use ranged attacks" — whether the
// character holds a row of the kind that only the surge is keeping closed.
function hasUnfocusedRow(c: CampaignCharacter, kind: WeaponAction['kind']): boolean {
  return getWieldedWeapons(c).some((wielded) =>
    wielded.weapon.attacks.some((atk) => isRowUsable(c, { wielded, weapon: wielded.weapon, atk }) && rowFits(atk, kind) && needsFocus(atk, c)))
}

export type LocationOption = { location: HitLocation; penalty: number }

// combat.tex "Localized damage", as a picker: each location and what aiming
// there costs the attack test.
export function getLocationOptions(): LocationOption[] {
  return HIT_LOCATIONS.map((location) => ({ location, penalty: LOCATIONS[location].penalty }))
}

// ---------------------------------------------------------------------------
// Costs and affordability

function canAfford(c: CampaignCharacter, cost: ActionCost): boolean {
  return c.resources.AP >= cost.AP && c.resources.STA >= cost.STA
}

// What an action costs its actor, as declared; null while the declaration is
// too incomplete to price.
export function getDeclaredCost(c: CampaignCharacter, action: Action): ActionCost | null {
  if (action.kind === 'strike' || action.kind === 'shoot' || action.kind === 'explosion') {
    const variant = getAttackVariant(c, action)
    return variant ? { AP: variant.AP, STA: variant.STA } : null
  }
  if (action.kind === 'move') return action.path.length > 0 ? getMovePrice(c, action, action.path.length) : null
  if (action.kind === 'evasion') return getEvasionCost(c, action.stay)
  // a reaction with no price of its own (an opportunity attack, a follow)
  // pays through the action it opens
  const price = ACTIONS[action.kind].price
  return price ? getActionCost(c, price) : { AP: 0, STA: 0 }
}

// combat.tex "Evasion": "spend 2 AP to react"; abilities.tex "Precise
// Reflexes": "If the character uses reflexes without moving, reflexes only
// cost 1 AP."
function getEvasionCost(c: CampaignCharacter, stay: boolean): ActionCost {
  return stay && c.abilities.includes('precise-reflexes') ? { AP: 1, STA: 0 } : getActionCost(c, 'reflex')
}

// ---------------------------------------------------------------------------
// The test

// combat.tex "Strike": strike, less the variation's penalty (combat.tex
// "Heavy Attack") and the location's (combat.tex "Localized damage").
// combat.tex "Accuracy": a shot is the Accuracy test instead, and the way of
// shooting may carry a bonus of its own (abilities.tex "Elite Sniper":
// "Snipe gets +1|2|3 to hit").
export function getAttackTerms(c: CampaignCharacter, action: AttackAction): Term[] {
  const variant = getAttackVariant(c, action)
  const shot = action.kind === 'shoot' ? getShotKind(action.variant) : null
  return [
    action.kind === 'strike' ? { label: 'strike', value: getStrike(c) } : { label: 'accuracy', value: getAccuracy(c) },
    { label: action.variant || 'variant', value: -(variant?.penalty ?? 0) },
    ...(shot ? [{ label: 'abilities', value: getBuffBonus(c, `hit:${shot}`) }] : []),
    { label: action.location, value: -LOCATIONS[action.location].penalty },
  ]
}

// combat.tex "Avoiding an Explosion": "make a reflex skill test against the
// DL of the explosion" — what a reaction that is a test of its own is
// rolled with.
export function getReactionTestTerms(state: CombatState, reaction: Action): Term[] {
  const reactor = state.characters[reaction.actorId]
  if (!reactor || reaction.kind !== 'avoidExplosion') return []
  return [{ label: 'reflex', value: getReflex(reactor) }]
}

// combat.tex "Reflex": what one reaction to a shot puts up against it — the
// reactor's reflexes (combat.tex "Accuracy": "against the opponent's
// reflexes"), and for a guard the shield's cover ("Guard": "Shield Cover is
// added to guard as a bonus").
function shotDefenseTerms(state: CombatState, reaction: Action): Term[] {
  const reactor = state.characters[reaction.actorId]
  if (!reactor) return []
  const terms: Term[] = [{ label: 'reflex', value: getReflex(reactor) }]
  if (reaction.kind === 'guard') {
    const row = findWeaponRow(reactor, reaction.weaponKey, reaction.attack)
    if (row?.weapon.shield) terms.push({ label: 'cover', value: row.weapon.shield.cover })
  }
  return terms
}

// The reaction a shot is met with: the target's own, or a guard made for
// them by someone adjacent (combat.tex "Guard": "block ranged attacks
// against themselves or adjacent characters"). A shot has to beat every one
// of them (the table's ruling), so the one it is scored against — and the
// one whose defense the damage meets — is whichever puts up the most.
export function getShotDefense(state: CombatState, root: Action): Action | null {
  return getReactionsTo(state, root.id)
    .filter((r) => r.kind === 'evasion' || r.kind === 'guard')
    .reduce<Action | null>((best, r) => (best === null || sumTerms(shotDefenseTerms(state, r)) > sumTerms(shotDefenseTerms(state, best)) ? r : best), null)
}

// combat.tex "Defend": the DL a strike is scored against is the defender's
// Defend if they react, "otherwise, they use the SD" (creating.tex "Standard
// Deflection"). An evasive jump "gives +AGI/3 on the skill test"; "Blocking
// with a shield adds its cover to defend".
// combat.tex "High Ground": "Both receive a +2 bonus to their melee defense
// against each other" — on the SD as much as on an active defense.
// combat.tex "Accuracy": a shot is scored "against the opponent's reflexes
// or their SD, should they choose not to react"; "Guard": "Shield Cover is
// added to guard as a bonus", the guard's own reflexes when it is an ally's.
export function getDLTerms(state: CombatState, root: Action): Term[] {
  if (root.kind === 'explosion') return getExplosionDLTerms(state, root)
  const defender = root.targetId ? state.characters[root.targetId] : undefined
  if (!defender) return []
  if (root.kind === 'shoot') {
    const reaction = getShotDefense(state, root)
    return reaction ? shotDefenseTerms(state, reaction) : [{ label: 'SD', value: getSD(defender) }]
  }
  const reaction = getReactionsTo(state, root.id).find((r) => r.actorId === defender.id)
  const terms: Term[] = !reaction ? [{ label: 'SD', value: getSD(defender) }] : [{ label: 'defend', value: getDefend(defender) }]
  if (reaction?.kind === 'evasiveJump') terms.push({ label: 'jump', value: Math.floor(getAGI(defender) / 3) })
  if (reaction?.kind === 'block') {
    const row = findWeaponRow(defender, reaction.weaponKey, reaction.attack)
    if (row?.weapon.shield) terms.push({ label: 'cover', value: row.weapon.shield.cover })
  }
  if (root.kind === 'strike' && isHighGround(state, root.actorId, defender.id)) terms.push({ label: 'high ground', value: 2 })
  // combat.tex "Opportunity Attack": "the defense takes -2 penalty unless
  // it's the SD"
  if (root.kind === 'strike' && root.opportunity && reaction) terms.push({ label: 'opportunity', value: -2 })
  return terms
}

export function getDL(state: CombatState, root: Action): number {
  return sumTerms(getDLTerms(state, root))
}

// play.tex "Degrees of success": over the DL by 5 is a hit, by 0 a graze,
// less a miss; an attack turns the critical band into HOP instead (play.tex
// "Hit Overflow Point"). gear.tex "Piercing": "Grazes behave like a miss."
export function scoreAttack(score: number, DL: number, piercing: boolean): { degree: Degree; HOP: number } {
  const over = score - DL
  if (over >= 5) return { degree: 'hit', HOP: over - 5 }
  if (over >= 0 && !piercing) return { degree: 'graze', HOP: 0 }
  return { degree: 'miss', HOP: 0 }
}

export function isPiercingAttack(c: Character, action: AttackAction): boolean {
  const row = findWeaponRow(c, action.weaponKey, action.attack)
  return row ? hasProperty(row.atk.properties, 'piercing') : false
}

// ---------------------------------------------------------------------------
// What can be declared

export type ActionOption = {
  label: string
  draft: ActionDraft
  cost: ActionCost | null
  available: boolean
  reason: string | null
  // the open action this option answers, for a reaction; null for an action
  reactionTo: string | null
  // a reaction the character has already declared
  chosen: boolean
}

// combat.tex "Grapple" — "Attack and Defend": "It is not possible to evade or
// block attacks, only intercept." combat.tex "Evasive Jump": "only ... if
// there is space to jump"; "jumping": a jump "cannot be voluntarily
// interrupted in the middle".
function defenseGate(state: CombatState, defender: CampaignCharacter, root: Action, kind: ActionKind, cost: ActionCost): { available: boolean; reason: string | null } {
  if (!canAfford(defender, cost)) return { available: false, reason: 'cannot afford' }
  if (reactsTo(kind, 'strike') && kind !== 'intercept' && getAfflictions(defender).includes('grappled')) return { available: false, reason: 'grappled' }
  if (kind === 'evasiveJump' && isMidJump(state, defender.id)) return { available: false, reason: 'mid-jump' }
  if (kind === 'evasiveJump' && !hasJumpSpace(state, defender.id, root.actorId)) return { available: false, reason: 'no space to jump' }
  return { available: true, reason: null }
}

// gear.tex "DEF": only a row with the property can block or intercept.
function defRows(c: Character): WeaponRow[] {
  return getWieldedWeapons(c).flatMap((wielded) =>
    wielded.weapon.attacks
      .map((atk) => ({ wielded, weapon: wielded.weapon, atk }))
      .filter((row) => hasProperty(row.atk.properties, 'DEF') && isRowUsable(c, row)),
  )
}

// combat.tex "Guard": "If using a shield"; gear.tex "Slow, Fast": a fast
// projectile "can only be blocked with a shield", a slow one may be guarded
// with any DEF row (the table's ruling). What the shot was fired with says
// which; nothing declared, a shield.
function guardRows(state: CombatState, c: Character, root: Action): WeaponRow[] {
  const shooter = state.characters[root.actorId]
  const shot = root.kind === 'shoot' && shooter ? findWeaponRow(shooter, root.weaponKey, root.attack) : null
  const slow = shot !== null && hasProperty(shot.atk.properties, 'slow')
  return defRows(c).filter((row) => slow || row.weapon.shield !== undefined)
}

// Everything the character may declare right now: their own actions while no
// action is open, and their reactions while a committed action triggers
// something in them and is still waiting for its die. A reaction's options
// are one per thing it can be done with, so a block names the weapon it
// blocks with.
export function getAvailableActions(state: CombatState, characterId: string): ActionOption[] {
  const c = state.characters[characterId]
  if (!c) return []
  const open = getOpenAction(state)

  if (!open) {
    const strikes = getAttackOptions(c, 'strike')
    const shots = getAttackOptions(c, 'shoot')
    const explosions = getAttackOptions(c, 'explosion')
    const placed = state.board?.placements[c.id] !== undefined
    return [
      {
        label: ACTIONS.strike.label,
        draft: { kind: 'strike' },
        cost: null,
        available: strikes.length > 0,
        reason: strikes.length > 0 ? null : 'no melee weapon in hand',
        reactionTo: null,
        chosen: false,
      },
      {
        label: ACTIONS.shoot.label,
        draft: { kind: 'shoot' },
        cost: null,
        available: shots.length > 0,
        reason: shots.length > 0 ? null : hasUnfocusedRow(c, 'shoot') ? 'needs a focus surge' : 'no shooting weapon in hand',
        reactionTo: null,
        chosen: false,
      },
      // an explosion is aimed at ground, so it needs a board to land on
      {
        label: ACTIONS.explosion.label,
        draft: { kind: 'explosion' },
        cost: null,
        available: explosions.length > 0 && placed,
        reason: explosions.length > 0 ? (placed ? null : 'not on the board') : hasUnfocusedRow(c, 'explosion') ? 'needs a focus surge' : 'no exploding weapon in hand',
        reactionTo: null,
        chosen: false,
      },
      {
        label: ACTIONS.move.label,
        draft: { kind: 'move' },
        cost: null,
        available: placed,
        reason: placed ? null : 'not on the board',
        reactionTo: null,
        chosen: false,
      },
    ]
  }

  if (open.status !== 'committed' || open.actorId === characterId) return []
  const declared = getReactionsTo(state, open.id).find((r) => r.actorId === characterId) ?? null
  const chosen = (draft: ActionDraft) => declared !== null && sameDraft(draft, declared)

  return getTriggersFor(state, open, characterId).flatMap((trigger): ActionOption[] => {
    const kind = trigger.kind
    const price = ACTIONS[kind].price
    const cost = price ? getActionCost(c, price) : { AP: 0, STA: 0 }
    const gate = defenseGate(state, c, open, kind, cost)
    const option = (label: string, draft: ActionDraft, own: ActionCost | null = cost): ActionOption =>
      ({ label, draft, cost: own, ...gate, reactionTo: open.id, chosen: chosen(draft) })
    switch (kind) {
      case 'block':
      case 'intercept':
        return defRows(c).map((row) => option(`${ACTIONS[kind].label} with ${row.weapon.name}`, { kind, weaponKey: row.wielded.key, attack: row.atk.name }))
      case 'guard':
        return guardRows(state, c, open).map((row) => option(`${ACTIONS[kind].label} with ${row.weapon.name}`, { kind, weaponKey: row.wielded.key, attack: row.atk.name }))
      // combat.tex "Evasion" lets the evader move after the shot; one who
      // stays put gives that up, for Precise Reflexes' price if they have it
      case 'evasion':
        return [
          option(ACTIONS[kind].label, { kind }),
          option(`${ACTIONS[kind].label}, staying put`, { kind, stay: true }, getEvasionCost(c, true)),
        ]
      // where an evasive jump lands is picked on the board, not here
      case 'evasiveJump':
        return [option(ACTIONS[kind].label, { kind })]
      // combat.tex "Opportunity Attack": "The attack requires the normal AP
      // cost" — it is open only to someone who can pay for a strike
      case 'opportunityAttack': {
        const strikes = getAttackOptions(c, 'strike')
        const reason = strikes.length === 0 ? 'no melee weapon in hand' : strikes.some((s) => canAfford(c, { AP: s.AP, STA: s.STA })) ? null : 'cannot afford a strike'
        const label = trigger.at !== null ? `${ACTIONS[kind].label} at step ${trigger.at}` : ACTIONS[kind].label
        return [{ ...option(label, { kind, at: trigger.at }, null), available: reason === null, reason }]
      }
      // combat.tex "Follow": a move of the follower's own, so it is open only
      // to someone who can pay for one
      case 'follow': {
        const reason = getMovementOptions(state, c).some((m) => m.available && canAfford(c, m.block)) ? null : 'cannot afford a move'
        return [{ ...option(ACTIONS[kind].label, { kind }, null), available: reason === null, reason }]
      }
      default:
        return [option(ACTIONS[kind].label, { kind })]
    }
  })
}

// Everyone with a reaction to the open action, each with their options —
// and, for one who has chosen an opportunity attack, the strike it opens
// still to be declared: its rows and where it aims.
export type ReactorOptions = {
  id: string
  name: string
  options: ActionOption[]
  strike: { options: AttackOption[]; locations: LocationOption[]; attack: string; variant: string; location: HitLocation; complete: boolean } | null
}

export function getReactors(state: CombatState, open: Action): ReactorOptions[] {
  return Object.values(state.characters)
    .filter((c) => c.id !== open.actorId)
    .map((c) => {
      const declared = getReactionsTo(state, open.id).find((r) => r.actorId === c.id)
      const strike = declared?.kind === 'opportunityAttack'
        ? { options: getAttackOptions(c, 'strike'), locations: getLocationOptions(), attack: declared.attack, variant: declared.variant, location: declared.location, complete: isDeclarationComplete(state, c, declared) }
        : null
      return { id: c.id, name: c.fightName ?? '', options: getAvailableActions(state, c.id), strike }
    })
    .filter((r) => r.options.length > 0)
}

// ---------------------------------------------------------------------------
// Where the open action stands

// The one thing the table is waiting on. `commit` is the actor's moment: the
// declaration is complete and waits to be locked. `react` is everyone
// else's — the action is committed, its triggers loaded, and the die may be
// thrown from it, with no reaction meaning SD. `spend` is a hit with HOP to
// spend before it is applied; the purchases are optional, so it is confirmed
// from there too. `aim` is an explosion waiting to be pointed at the board:
// a disk's centre before the commit, a spray's direction once the reactions
// have moved (combat.tex "Sprays").
export type ActionStep = 'declare' | 'target' | 'aim' | 'commit' | 'react' | 'spend' | 'confirm'

export function getNextStep(state: CombatState): ActionStep | null {
  const open = getOpenAction(state)
  if (!open) return null
  if (open.status === 'rolled') {
    if (open.kind === 'explosion') return getExplosionArea(state, open)?.shape === 'spray' && open.direction === null ? 'aim' : 'confirm'
    return (open.kind === 'strike' || open.kind === 'shoot') && open.roll?.degree === 'hit' ? 'spend' : 'confirm'
  }
  if (open.status === 'committed') return 'react'
  const actor = state.characters[open.actorId]
  if (!actor) return 'declare'
  if (open.kind === 'explosion') return getAttackVariant(actor, open) === null ? 'declare' : isAimed(state, open) ? 'commit' : 'aim'
  if (!isDeclarationComplete(state, actor, open)) return 'declare'
  if (open.kind === 'move') return 'commit'
  if (open.targetId === null || !getTargetIds(state, open).includes(open.targetId)) return 'target'
  return 'commit'
}

// The option a draft would take, so a command can refuse exactly what the
// list shows as closed.
export function findOption(state: CombatState, characterId: string, draft: ActionDraft): ActionOption | null {
  return getAvailableActions(state, characterId).find((o) => sameDraft(o.draft, draft)) ?? null
}

function sameDraft(option: ActionDraft, draft: ActionDraft): boolean {
  if (option.kind !== draft.kind) return false
  if (option.kind === 'block' || option.kind === 'intercept' || option.kind === 'guard') {
    const d = draft as { weaponKey?: string; attack?: string }
    return option.weaponKey === d.weaponKey && option.attack === d.attack
  }
  if (option.kind === 'opportunityAttack') return (option.at ?? null) === ((draft as { at?: number | null }).at ?? null)
  if (option.kind === 'evasion') return (option.stay ?? false) === ((draft as { stay?: boolean }).stay ?? false)
  return true
}

// Who a character is to an action.
export type Role = 'actor' | 'target' | 'reactor' | 'none'

export function getRole(state: CombatState, root: Action, characterId: string): Role {
  if (root.actorId === characterId) return 'actor'
  if (getReactionsTo(state, root.id).some((r) => r.actorId === characterId)) return 'reactor'
  if (root.targetId === characterId) return 'target'
  if (root.kind === 'explosion' && getAffected(state, root).some((a) => a.id === characterId)) return 'target'
  return 'none'
}

// Who can be aimed at: everyone in the fight but the actor, and for a strike
// only those its reach covers from where the actor stands, for a shot only
// those the way of shooting carries to and that are in sight. A target the
// declaration has since put out of reach (a change of location on the high
// ground, a change from snipe to quick shot) drops off this list and has to
// be aimed at again.
export function getTargetIds(state: CombatState, root: Action): string[] {
  if (root.kind === 'move' || root.kind === 'explosion') return []
  return Object.keys(state.characters).filter((id) =>
    id !== root.actorId
    && (root.kind !== 'strike' || isInReach(state, root, id))
    && (root.kind !== 'shoot' || isInShotRange(state, root, id)))
}
