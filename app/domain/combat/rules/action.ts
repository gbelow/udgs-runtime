import type { AttackKind, CampaignCharacter, Character, Weapon, WeaponAttack } from '../../types'
import { ActionSchema, type Action, type ActionDraft, type ActionKind, type ActionOf, type ActionRoll, type AttackAction, type CastAction, type CombatState, type HitLocation, type StrikeAction, type WeaponAction } from '../types'
import { ACTIONS, reactsTo } from '../actionCatalog'
import { GRAZE_SAVE, LOCATIONS, QUICKEN_DL, SPELL_MODIFICATIONS, type SpellModification } from '../../tables'
import { SPELLS, isSpellKey, type SpellKey } from '../../spells'
import { canCastSpell, getCastingDL, getMissingGear, getSpellSkill } from '../../character/rules/spells'
import { getEffectRange, getTargetEffects } from '../../character/rules/production'
import { HIT_LOCATIONS } from '../../lists'
import { getWieldedWeapons, isAttackUsable, Wielded } from '../../item/rules/hands'
import { AttackVariant, getAttacksList, getShotKind, isWieldable, needsFocus } from '../../character/rules/gear'
import { getAccuracy, getDefend, getReflex, getSD, getStrike } from '../../character/rules/skills'
import { getAGI } from '../../character/rules/characteristics'
import { getAfflictions } from '../../character/rules/afflictions'
import { getBuffBonus } from '../../character/rules/effects'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { Term, sumTerms } from '../../character/rules/terms'
import { getAttackKind, hasProperty } from '../../weaponProperties'
import { isCampaignCharacter } from '../../utils'
import { getDistanceBetween, hasLineOfSight, isHighGround, isInReach, isInShotRange } from './board'
import { getBalanceDL, getBalanceTestTerms, getMovePrice, getMoveWaypoint, getMovementOptions, hasJumpSpace, isMidJump, isPathLegal, needsBalanceTest } from './move'
import { resolveTest, type Test } from './test'
import { getAffected, getChargeOptions, getChargedItem, getExplosionDLTerms, getExplosionPayload, hasExplosionPayload, isAimed, isSpray } from './explosion'
import { getTriggersFor } from './reactions'
import { isCastCancelled } from './cast'

// ---------------------------------------------------------------------------
// Finding actions in the fight

// The action being played out: the first root not yet resolved. Nothing can
// be declared while one is open, so there is only ever one — except for the
// actions a reaction opens (an opportunity attack, a follow, an escape from
// a blast), which are played out ahead of whatever they were opened
// against: an opportunity attack on a mover is fought while the move waits
// to resolve. They stack, so the one opened last goes first — an explosion
// a cast opened waits for the escapes its own reactions opened.
export function getOpenAction(state: CombatState): Action | null {
  const roots = state.actions.filter((a) => a.reactionTo === null && a.status !== 'resolved')
  return [...roots].reverse().find((a) => a.spawnedBy !== null) ?? roots[0] ?? null
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
// the property. Whether it has anything to go off with is the charge's.
function explodes(atk: WeaponAttack): boolean {
  return hasProperty(atk.properties, 'explosion')
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
    // thrown, the row is declared and can be fired; cast, the spell was;
    // set off, a charged spell with something to go off is named
    case 'explosion':
      return (action.source !== 'thrown' || getAttackVariant(c, action) !== null)
        && (action.source !== 'cast' || isSpellKey(action.key))
        && (action.source !== 'detonate' || getChargedItem(state, action.itemId) !== null)
        && getExplosionPayload(state, action) !== null && isAimed(state, action)
    case 'cast':
      return isCampaignCharacter(c) && isSpellKey(action.key) && canCastSpell(c, action.key, action.quicken)
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
  // a cast's explosion was paid for by the cast; a charge set off costs
  // whoever sets it off nothing
  if (action.kind === 'explosion' && action.source !== 'thrown') return { AP: 0, STA: 0 }
  if (action.kind === 'strike' || action.kind === 'shoot' || action.kind === 'explosion') {
    const variant = getAttackVariant(c, action)
    return variant ? { AP: variant.AP, STA: variant.STA } : null
  }
  if (action.kind === 'move') return action.path.length > 0 ? getMovePrice(c, action, action.path.length) : null
  // spells.tex "Casting spells": the spell's own price; what it asks beyond
  // AP and STA is paid the same, off the sheet
  if (action.kind === 'cast') return isSpellKey(action.key) ? { AP: SPELLS[action.key].cost.AP, STA: SPELLS[action.key].cost.STA } : null
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
// spells.tex "Casting spells": the DL is the spell's own; "Quicken Spell:
// Increases spell DL by 4".
export function getCastTerms(c: CampaignCharacter, action: CastAction): Term[] {
  return isSpellKey(action.key) ? [{ label: SPELLS[action.key].name, value: getSpellSkill(c, action.key) }] : []
}

export function getDLTerms(state: CombatState, root: Action): Term[] {
  if (root.kind === 'explosion') return getExplosionDLTerms(state, root)
  if (root.kind === 'cast') {
    if (!isSpellKey(root.key)) return []
    return [{ label: 'spell DL', value: SPELLS[root.key].DL ?? 0 }, ...(root.quicken ? [{ label: 'quicken', value: QUICKEN_DL }] : [])]
  }
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

// The test a committed root is closed by, or null when it has none of its
// own. A strike or a shot against the target's defense, trading the critical
// for HOP (play.tex "Hit Overflow Point"); a move across difficult terrain a
// Balance test against the ground (combat.tex "Balance"); a cast against the
// spell's DL, its overflow the HOP that buy improvements, and a graze left
// open to be saved unless it was quickened (spells.tex "Casting spells";
// "Quicken Spell": "Grazes equal misses").
export function getRootTest(state: CombatState, root: Action): Test | null {
  const actor = state.characters[root.actorId]
  if (!actor) return null
  switch (root.kind) {
    case 'strike':
    case 'shoot':
      return { skill: sumTerms(getAttackTerms(actor, root)), DL: getDL(state, root), explodes: false, scale: 'overflow', grazes: !isPiercingAttack(actor, root) }
    case 'move':
      return { skill: sumTerms(getBalanceTestTerms(actor)), DL: getBalanceDL(state, root), explodes: false, scale: 'degrees' }
    case 'cast':
      return { skill: sumTerms(getCastTerms(actor, root)), DL: getDL(state, root), explodes: false, scale: 'overflow', grazes: !root.quicken }
    default:
      return null
  }
}

// A reaction that is a test of its own, scored against the root's DL.
export function getReactionTest(state: CombatState, root: Action, reaction: Action): Test {
  return { skill: sumTerms(getReactionTestTerms(state, reaction)), DL: getDL(state, root), explodes: false, scale: 'degrees' }
}

// spells.tex "Casting spells": "In case of a graze in combat, there is the
// option to increase spell cost by 2 AP to gain +3 once in the test if that
// will turn the graze into a hit." The die stays as thrown; the roll is
// read again with the bonus.
export function getGrazeSavedRoll(roll: ActionRoll): ActionRoll {
  return resolveTest({ skill: roll.score - roll.die + GRAZE_SAVE.bonus, DL: roll.DL, explodes: false, scale: 'overflow', grazes: true }, () => roll.die)
}

export function canSaveGraze(state: CombatState, root: CastAction): boolean {
  const caster = state.characters[root.actorId]
  if (!caster || root.status !== 'rolled' || root.grazeSaved || !root.roll || root.roll.degree !== 'graze') return false
  if (isCastCancelled(state, root) || caster.resources.AP < GRAZE_SAVE.AP) return false
  return getGrazeSavedRoll(root.roll).degree === 'hit'
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
// spells.tex "Concentration": "No other action or reaction can be performed
// while concentrating" — while an opportunity attack against `defenderId`
// answers a still-live cast of their own, that is the cast they would have
// to give up (`cancelCast`) to perform it.
function getConcentratingCast(state: CombatState, root: Action, defenderId: string): CastAction | null {
  const reaction = root.spawnedBy ? getAction(state, root.spawnedBy) : null
  const cast = reaction?.reactionTo ? getAction(state, reaction.reactionTo) : null
  return reaction?.kind === 'opportunityAttack' && cast?.kind === 'cast' && cast.actorId === defenderId && !cast.cancelled ? cast : null
}

export function isConcentrating(state: CombatState, root: Action, defenderId: string): boolean {
  return getConcentratingCast(state, root, defenderId) !== null
}

function defenseGate(state: CombatState, defender: CampaignCharacter, root: Action, kind: ActionKind, cost: ActionCost): { available: boolean; reason: string | null } {
  if (!canAfford(defender, cost)) return { available: false, reason: 'cannot afford' }
  if (reactsTo(kind, 'strike') && getConcentratingCast(state, root, defender.id)) return { available: false, reason: 'cancel the spell to defend actively' }
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
    const explosions = getAttackOptions(c, 'explosion').filter((o) => hasExplosionPayload(c, o.weaponKey, o.attack))
    const spells = getSpellOptions(c)
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
        draft: { kind: 'explosion', source: 'thrown' },
        cost: null,
        available: explosions.length > 0 && placed,
        reason: explosions.length > 0 ? (placed ? null : 'not on the board') : hasUnfocusedRow(c, 'explosion') ? 'needs a focus surge' : getAttackOptions(c, 'explosion').length > 0 ? 'nothing charged into it' : 'no exploding weapon in hand',
        reactionTo: null,
        chosen: false,
      },
      // combat.tex "Explosions": "If the explosion occurs before being
      // perceived, no test can be made" — a charge or a trap set off by the
      // table, from wherever the active character stands
      {
        label: 'set off a charge',
        draft: { kind: 'explosion', source: 'detonate' },
        cost: null,
        available: placed && getChargeOptions(state).length > 0,
        reason: placed ? (getChargeOptions(state).length > 0 ? null : 'nothing is charged') : 'not on the board',
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
      {
        label: ACTIONS.cast.label,
        draft: { kind: 'cast' },
        cost: null,
        available: spells.some((s) => s.castable || s.quickenable),
        reason: spells.some((s) => s.castable || s.quickenable) ? null : spells.length > 0 ? 'no spell castable now' : 'no spell learned',
        reactionTo: null,
        chosen: false,
      },
    ]
  }

  // the actor answers nothing of their own — except a blast, which reaches
  // them where they stand like anyone else (combat.tex "Explosions")
  if (open.status !== 'committed' || (open.actorId === characterId && open.kind !== 'explosion')) return []
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

// The spells the character could declare a cast of: each learned spell,
// with whether it can be cast on the focus surge or quickened without it
// (spells.tex "Quicken Spell").
export type SpellOption = {
  key: SpellKey
  name: string
  DL: number | null
  quickenedDL: number | null
  cost: ActionCost
  castable: boolean
  quickenable: boolean
  // why it cannot be cast, when it cannot
  reason: string | null
  // whether it aims at someone
  targeted: boolean
}

// spells.tex "Requirements", "Casting spells": what stands between the
// caster and the spell, the missing gear first — it is the one the caster
// can do something about from here.
function reasonAgainst(c: CampaignCharacter, key: SpellKey): string | null {
  const spell = SPELLS[key]
  const missing = getMissingGear(c, key)
  if (missing) return `needs ${missing}`
  if (!canAfford(c, { AP: spell.cost.AP, STA: spell.cost.STA })) return 'cannot pay for it'
  if (spell.DL === null) return 'no casting DL'
  return canCastSpell(c, key, false) ? null : 'needs a focus surge'
}

export function getSpellOptions(c: CampaignCharacter): SpellOption[] {
  return (Object.keys(c.spells) as SpellKey[]).filter(isSpellKey).map((key) => {
    const spell = SPELLS[key]
    return {
      key,
      name: spell.name,
      DL: spell.DL,
      quickenedDL: getCastingDL(spell, true),
      cost: { AP: spell.cost.AP, STA: spell.cost.STA },
      castable: canCastSpell(c, key, false),
      quickenable: canCastSpell(c, key, true),
      reason: reasonAgainst(c, key),
      targeted: spell.type !== 'charged' && getTargetEffects(spell).length > 0,
    }
  })
}

// spells.tex "Spell Improvements": what the cast's overflow can still buy,
// each priced in SOP.
export type ImprovementOption = {
  name: SpellModification
  SOP: number
  text: string
  times: number
  available: boolean
}

export function getSOPRemaining(root: CastAction): number {
  return (root.roll?.HOP ?? 0) - (Object.keys(SPELL_MODIFICATIONS) as SpellModification[]).reduce((sum, m) => sum + (root.improved[m] ?? 0) * SPELL_MODIFICATIONS[m].SOP, 0)
}

// spells.tex "Concentration": nothing left to spend overflow on once the
// cast is cancelled — it produces nothing regardless of what is bought.
export function getImprovementOptions(state: CombatState, root: CastAction): ImprovementOption[] {
  if (!root.roll || root.roll.degree !== 'hit' || isCastCancelled(state, root)) return []
  const remaining = getSOPRemaining(root)
  return (Object.keys(SPELL_MODIFICATIONS) as SpellModification[]).map((name) => ({
    name,
    SOP: SPELL_MODIFICATIONS[name].SOP,
    text: SPELL_MODIFICATIONS[name].text,
    times: root.improved[name] ?? 0,
    available: SPELL_MODIFICATIONS[name].SOP <= remaining,
  }))
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
    if (open.kind === 'explosion') return isSpray(state, open) && open.direction === null ? 'aim' : 'confirm'
    if (open.kind === 'cast' && isCastCancelled(state, open)) return 'confirm'
    return (open.kind === 'strike' || open.kind === 'shoot' || open.kind === 'cast') && open.roll?.degree === 'hit' ? 'spend' : 'confirm'
  }
  if (open.status === 'committed') return 'react'
  const actor = state.characters[open.actorId]
  if (!actor) return 'declare'
  if (open.kind === 'explosion') return getExplosionPayload(state, open) === null ? 'declare' : isAimed(state, open) ? 'commit' : 'aim'
  if (!isDeclarationComplete(state, actor, open)) return 'declare'
  if (open.kind === 'move') return 'commit'
  if (open.kind === 'cast' && !isTargeted(open)) return 'commit'
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
  if (option.kind === 'explosion') return (option.source ?? 'thrown') === ((draft as { source?: string }).source ?? 'thrown')
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
  if (root.kind === 'cast' && !isTargeted(root)) return []
  return Object.keys(state.characters).filter((id) =>
    id !== root.actorId
    && (root.kind !== 'strike' || isInReach(state, root, id))
    && (root.kind !== 'shoot' || isInShotRange(state, root, id))
    && (root.kind !== 'cast' || isInCastRange(state, root, id)))
}

// Whether the spell as declared aims at someone: it has an effect for one
// target, and is not cast on an object (spells.tex "Charged": what it does
// waits in the object, and is aimed when the charge is released).
export function isTargeted(root: CastAction): boolean {
  return isSpellKey(root.key) && SPELLS[root.key].type !== 'charged' && getTargetEffects(SPELLS[root.key]).length > 0
}

// Whether every targeted effect of the spell reaches the target from where
// the caster stands, at the range bought (spells.tex "Extend Spell"), in
// sight; touch reaches an adjacent target. True on a fight without a board.
function isInCastRange(state: CombatState, root: CastAction, targetId: string): boolean {
  const distance = getDistanceBetween(state, root.actorId, targetId)
  if (distance === null || !isSpellKey(root.key)) return true
  return getTargetEffects(SPELLS[root.key]).every((e) => distance <= (getEffectRange(e, root.improved) ?? 1)) && hasLineOfSight(state, root.actorId, targetId)
}
