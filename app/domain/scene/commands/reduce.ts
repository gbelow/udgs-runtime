import type { CampaignCharacter } from '../../types'
import { HazardLayerSchema, TerrainCellSchema, type Action, type AttackAction, type Board, type SceneState, type FloorItem, type Bind, type Grapple, type GrappleFacts, type MoveAction, type Placement, type ShootAction, type Tether, type Trample } from '../types'
import { getFootprint, placeAt } from '../rules/board/board'
import { getDepthAfter, readWater } from '../rules/swim'
import { payCost } from '../../character/commands/cost'
import { cure, inflict } from '../../character/commands/addAffliction'
import { deliver, deliverAll, touchFire } from '../../character/commands/deliver'
import { chargeItem, consumeItem, dischargeItem, drawFromSource, dropItem, holdItem, loadItem } from '../../item/commands/hands'
import { getHeldItem } from '../../item/rules/hands'
import { findAmmoStack } from '../../item/rules/ammo'
import { removeItemFromContainer } from '../../item/commands/items'
import { findWeaponRow } from '../rules/weaponRow'
import { needsReload } from '../../character/rules/gear'
import { getAttackKind } from '../../weaponProperties'
import { breakOne, onFloor, withoutOne } from '../rules/floor'
import { isFloorAttack } from '../rules/equipment'
import { getGroundCell } from '../rules/floorAttack'
import { getBurnOf } from '../rules/ignition'
import { isVoided } from '../rules/opportunity'
import { isStoppedByGuard } from '../rules/attack'
import { getMoveDestination } from '../rules/board/waypoint'
import { getActionHeading } from '../rules/detection'
import { isAttackAction } from '../rules/actionCatalog'
import { getBreaks, getBrokenItems } from '../rules/breakage'
import { getChargedWeapon, getHOPPrice } from '../rules/damage'
import { HOP_PURCHASES } from '../../lists'
import { getGrappleFacts, replacePair } from '../rules/grapple'
import { dropHolders } from '../rules/bind'
import { isGrapple, isTether } from '../rules/partners'
import { getNetTethers, isNetCut } from '../rules/cut'
import { getArcMade } from '../rules/fireAgain'
import { findSlipTether, getTethersMade, isTying } from '../rules/tether'
import { isWon } from '../rules/test'
import { coordKey } from '../rules/board/geometry'
import { SPELLS, isSpellKey } from '../../spells'
import { SPELL_LIGHT, STUN_AP } from '../../tables'
import { GRAZE_SAVE_COST, getCastCharges, getCastSpentAP, getLinkOutcome, type LinkOutcome } from '../rules/cast'
import { getCastSize, getEffortlessCost } from '../../character/rules/spells'
import { getFireAgainCharges } from '../rules/fireAgain'
import { restCharacter, restWhileCasting } from '../../character/commands/rest'
import { takeDose } from '../../character/commands/consume'
import { getInterruptionOf } from '../rules/interruption'
import { loseConcentration } from '../../character/commands/spells'
import { getAction, getReactionsTo } from '../rules/log'
import { extinguishCell } from '../rules/extinguish'
import { coatCell, filterLayers, igniteCell, getHolderOf, isSupersededBy, type FireTouched } from '../rules/board/hazard'
import { actionSurge } from '../../character/commands/actionSurge'
import { getPassingPlacement } from '../rules/sidestep'

// The moments an action touches a character: `roll`, when the die is thrown
// and the price leaves the actor in the same step; `save`, when a graze is
// bought up after the roll and its price leaves the actor; and `resolve`,
// when what the action did lands on whoever it was done to.
export type Phase = 'roll' | 'save' | 'resolve'

// The one place an action changes a character. It reads the action and the
// character's part in it — actor, target, nobody — and applies only that
// part, so a fight can run every character through it and the ones an action
// does not concern come out untouched. Everything it needs is on the action:
// what had to be looked up across two characters was written there by the
// command that made the transition; what the action delivers is handed to
// the character's own effect processor, which needs nothing but the record.
// One the action interrupted stops concentrating, and every spell they held
// ends with it (abilities.tex "Battle Mage": "When interrupted, instead of
// losing the spell") — a won maneuver here; a blow that interrupts or stuns
// ends it where it lands (character/commands/deliver.ts), as a crash does
// (`trampledBy`). The holder of the turn touches the fire the landing left
// them in (`getFireTouched`), read off the board the action put them on.
export function reduceCharacter(action: Action, phase: Phase, charged: boolean, fire: FireTouched | null = null): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const reduced = reducePart(action, phase, charged)(c)
    if (phase !== 'resolve') return reduced
    const damaged = deliverAll(getBreaks(action)[c.id] ?? [])(reduced)
    const touched = fire?.id === c.id ? touchFire(fire.fire)(damaged) : damaged
    return getInterruptionOf(action, c.id) !== 'none' ? loseConcentration(touched) : touched
  }
}

// combat.tex "Interruption": the AP of the action given up, given back
function refund(AP: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => (AP > 0 ? { ...c, resources: { ...c.resources, AP: c.resources.AP + AP } } : c)
}

function reducePart(action: Action, phase: Phase, charged: boolean): (c: CampaignCharacter) => CampaignCharacter {
  return (before: CampaignCharacter) => {
    const c = phase === 'resolve' ? settleGrapple(getGrappleFacts(action), before) : before
    switch (phase) {
      case 'roll':
        if (c.id !== action.actorId || !action.cost) return c
        // combat.tex "Flee": the movement surge, made as a reaction
        if (action.kind === 'flee' || action.kind === 'fleeFollowUp') return actionSurge('movement')(c)
        // a held spell fired again draws its charges as it is paid for
        if (action.kind === 'fireAgain') return drawFromSource(action.itemId, getFireAgainCharges(action))(payCost(action.cost, charged)(c))
        return refund(action.refunded)(payCost(action.cost, charged)(c))
      case 'save':
        if (c.id !== action.actorId || action.kind !== 'cast' || !action.grazeSaved) return c
        return payCost(GRAZE_SAVE_COST, charged)(c)
      case 'resolve':
        // combat.tex "Balance": a move on difficult terrain at a speed the
        // test did not clear ends in a fall
        // combat.tex "Movement": "Stand up: Removes the prone condition" —
        // unless an opportunity attack cancelled it ("Interruption")
        if (action.kind === 'move') {
          if (c.id !== action.actorId) return trampledBy(action.facts?.trampled ?? [], c, charged)
          // combat.tex "Interruption": the blocks it did not walk are given back
          const trampled = trampledBy(action.facts?.trampled ?? [], payCost({ AP: -action.unwalked.AP, STA: -action.unwalked.STA }, charged)(c), charged)
          if (action.movement === 'stand') return action.facts?.stop === 'end' ? standUp(c) : c
          if (action.movement === 'prone') return fallProne(c)
          if (action.movement === 'swim' && action.facts?.finish === 'prone') return fallProne(trampled)
          if (action.movement === 'climb') return action.facts?.finish === 'prone' ? fallProne(trampled) : action.facts?.finish === 'standing' ? standUp(trampled) : trampled
          return action.facts?.fell ? fallProne(trampled) : trampled
        }
        // combat.tex "Interruption": the cells of the block it did not go are
        // given back to whoever walked it
        if (action.kind === 'drag') {
          const back = action.unwalked[c.id]
          return back ? payCost({ AP: -back.AP, STA: -back.STA }, charged)(c) : c
        }
        // combat.tex "Explosions": the object a charge went off in is
        // destroyed by it, in whoever's hand it was
        if (action.kind === 'explosion') return action.source !== 'cast' && !isHeldTying(c, action.itemId) ? consumeItem(action.itemId)(c) : c
        // everyone in the area takes it, the attacker as much as anyone
        if (action.kind === 'blast') return deliverAll(action.facts?.[c.id] ?? [])(c)
        // gear.tex "Electrite": a cast draws its charges from its gear
        // whatever the die says, at the size it ended up cast at (spells.tex
        // "Amplify Spell"). spells.tex "Sustained": a cast that hit and did
        // not fail is taken hold of by its caster, its upkeep due at the
        // round change, bound to its target if it is fired again at one;
        // "Effortless Spell": the caster rested while casting it
        if (action.kind === 'cast') {
          const own = c.id === action.actorId && isSpellKey(action.key) ? drawFromSource(action.itemId, getCastCharges(c, action))(c) : c
          const landed = deliverAll(action.facts?.[c.id] ?? [])(own)
          if (c.id !== action.actorId || !isSpellKey(action.key) || action.roll?.degree !== 'hit' || action.failed) return landed
          const delivered = action.improved.effortless ? restWhileCasting(getEffortlessCost(landed, getCastSpentAP(action)), charged)(landed) : landed
          const spell = SPELLS[action.key]
          // spells.tex "Lamp", "Revealing Light": the torch it was cast with
          // shines for the rest of the fight, the last cast into it winning
          if (action.key in SPELL_LIGHT && action.itemId) {
            const others = delivered.active.filter((e) => !(e.kind === 'light' && e.itemId === action.itemId))
            return { ...delivered, active: [...others, { kind: 'light', key: action.key, itemId: action.itemId }] }
          }
          if (spell.type === 'sustained' && !delivered.active.some((e) => e.kind === 'spell' && e.key === action.key)) {
            const size = getCastSize(c, action.key, action.improved.amplify ?? 0, action.itemId)
            return { ...delivered, active: [...delivered.active, { kind: 'spell', key: action.key, itemId: action.itemId, size, extend: action.extend }] }
          }
          // spells.tex "Charged": "activates an object that stays charged"
          return spell.type === 'charged' ? chargeItem(action.key, action.improved, action.itemId, action.chargeItemId)(delivered) : delivered
        }
        // spells.tex "Telepathic Link": what the test let through lands on
        // the target, and what a morale spell's test left them (combat.tex
        // "Morale")
        if (action.kind === 'spellTest') {
          const delivered = deliverAll(action.facts?.[c.id] ?? [])(c)
          const morale = c.id === action.targetId ? action.morale : null
          return morale ? inflict(morale.inflict)(cure(morale.cure)(delivered)) : delivered
        }
        // combat.tex "Balance": what the landing did to the one who fell
        if (action.kind === 'fall') return deliverAll(action.facts?.[c.id] ?? [])(c)
        if (action.kind === 'fireAgain') return deliverAll(action.facts?.[c.id] ?? [])(c)
        if (action.kind === 'rest') return c.id === action.actorId ? restCharacter(c) : c
        // combat.tex "Social actions": each "counts as a Rest action";
        // unflagging a surrender is free and no rest
        if ((action.kind === 'social' && action.say !== 'unsurrender') || action.kind === 'taunt') return c.id === action.actorId ? restCharacter(c) : c
        // gear.tex "Potions and Medicine": a dose taken out of what is held
        if (action.kind === 'drink') return c.id === action.actorId && action.drunk ? takeDose(action.itemId)(c) : c
        // abilities.tex "Medicine": what the treatment did to whoever it was
        // given; First Aid: "On a hit or crit, prevents bleeding that turn
        // completely" — staunched for the round
        if (action.kind === 'cauterize') return deliverAll(action.facts?.[c.id] ?? [])(c)
        if (action.kind === 'firstAid') {
          const treated = deliverAll(action.facts?.[c.id] ?? [])(c)
          return isWon(action) && c.id === action.targetId ? { ...treated, injuries: { ...treated.injuries, staunched: true } } : treated
        }
        if (action.kind === 'pickUp') return c.id === action.actorId && action.picked ? holdItem(action.picked)(c) : c
        // gear.tex "Reload": one arrow or bolt leaves its stack and waits in
        // the weapon
        if (action.kind === 'reload') return c.id === action.actorId && action.loaded ? loadItem(action.weaponKey, action.loaded)(spendAmmo(c, action.ammoId)) : c
        // combat.tex "Throw": one of what was thrown leaves whichever hand it
        // was thrown from; one thrown off the floor was never in it
        if (action.kind === 'throw') return c.id === action.actorId && action.thrown && c.held.some((i) => i.id === action.itemId) ? consumeItem(action.itemId)(c) : c
        if (!isAttackAction(action)) return c
        // spells.tex "Charged": the charge goes off with the blow that
        // lands — "discharges on the first object it comes into contact
        // with" — and leaves the object empty. A row that pierces has no
        // graze to land on (combat.tex "Piercing"), so it goes off or it
        // does not.
        // A purchase with a price of its own is paid as it lands (combat.tex
        // "Assassinate": "1 extra AP").
        if (c.id === action.actorId) {
          const chargedWeapon = getChargedWeapon(c, action)
          const discharged = chargedWeapon && action.roll && action.roll.degree !== 'miss' ? dischargeItem(chargedWeapon.id)(c) : c
          const paid = HOP_PURCHASES.reduce((acc, p) => {
            const price = (action.spent[p] ?? 0) > 0 ? getHOPPrice(p, acc) : null
            return price ? payCost(price, charged)(acc) : acc
          }, discharged)
          // combat.tex "Throw": what is thrown leaves the hand
          if (action.kind === 'shoot') return spendShot(releaseThrown(paid, action.weaponKey, action.attack), action)
          // combat.tex "Braced Attack": the crash it triggers, the mover the
          // blow met against the bracer
          return action.trample ? trampledBy([action.trample], paid, charged) : paid
        }
        if (c.id !== action.targetId || !action.facts) return c
        const struck = deliver(action.facts)(c)
        return action.kind === 'strike' && action.trample ? trampledBy([action.trample], struck, charged) : struck
    }
  }
}

const fallProne = inflict(['prone'])
const standUp = cure(['prone'])

// combat.tex "Throw": a thrown row is made by letting go of the weapon; a
// natural weapon or a shooting one stays where it is.
function releaseThrown(c: CampaignCharacter, weaponKey: string, attack: string): CampaignCharacter {
  const row = findWeaponRow(c, weaponKey, attack)
  if (!row || row.wielded.natural || getAttackKind(row.atk.range) !== 'throw') return c
  return consumeItem(row.wielded.itemId)(c)
}

// gear.tex "Quiver": the shot takes one arrow or bolt from the stack it was
// loaded from, and it is gone; gear.tex "Reload": a row that is reloaded
// fires what was loaded in it, and leaves the weapon empty.
function spendShot(c: CampaignCharacter, action: ShootAction): CampaignCharacter {
  const row = findWeaponRow(c, action.weaponKey, action.attack)
  return row && needsReload(row.atk) ? loadItem(row.wielded.itemId, null)(c) : spendAmmo(c, action.ammoId)
}

function spendAmmo(c: CampaignCharacter, ammoId: string): CampaignCharacter {
  const stack = findAmmoStack(c, ammoId)
  return stack ? { ...c, containers: removeItemFromContainer(stack.containerKey, ammoId, 1)(c).containers } : c
}

// combat.tex "Grapple Maneuvers": what the maneuver did to the character
// beyond the grapple itself — knocked down, an item knocked out of their
// hand — and what the holds dealt them. The grappled and immobile
// afflictions are read off the grapple (`getGrappleAfflictionsOf`).
function settleGrapple(facts: GrappleFacts | null, c: CampaignCharacter): CampaignCharacter {
  if (!facts) return c
  const down = facts.prone.includes(c.id) ? fallProne(c) : c
  const disarmed = facts.dropped?.ownerId === c.id ? dropItem(facts.dropped.itemId)(down) : down
  return deliverAll(facts.deliveries[c.id] ?? [])(disarmed)
}

// The one place an action changes who is bound to whom: the pair's grapple
// replaced with what the action left of it.
export function reduceBinds(state: SceneState, action: Action, phase: Phase): (binds: Bind[]) => Bind[] {
  return (binds: Bind[]) => {
    if (phase !== 'resolve') return binds
    if (action.kind === 'spellTest') return withLinks(binds, getLinkOutcome(state, action))
    if (action.kind === 'cast') {
      const arc = getArcMade(state, action)
      return arc ? [...binds, arc] : binds
    }
    if (action.kind === 'blast') return withTethers(binds, getTethersMade(state, action))
    if (action.kind === 'cut') return isNetCut(state, action) ? binds.filter((b) => !getNetTethers(state, action).includes(b as Tether)) : binds
    if (action.kind === 'slip') return isWon(action) ? binds.filter((b) => b !== findSlipTether(state, action)) : binds
    const grapples = binds.filter(isGrapple)
    const others = binds.filter((b) => !isGrapple(b))
    const next = reduceGrapplesOf(action, grapples)
    return next === grapples ? binds : [...others, ...next]
  }
}

// Whether the item is one the character holds that stays in their hand when
// it goes off, tied to what it caught.
function isHeldTying(c: CampaignCharacter, itemId: string): boolean {
  const item = getHeldItem(c, itemId)
  return !!item && isTying(item)
}

// The binds with the link a spell test made, or without the one it broke.
function withLinks(binds: Bind[], { made, broken }: LinkOutcome): Bind[] {
  if (made) return [...binds, made]
  if (!broken) return binds
  return binds.filter((b) => !(b.kind === 'link' && b.holders[0] === broken.casterId && b.members.includes(broken.targetId) && b.key === broken.key))
}

// The binds with each new tether in place of the one its pair had.
function withTethers(binds: Bind[], made: Tether[]): Bind[] {
  if (made.length === 0) return binds
  const tied = (b: Bind, t: Tether) => isTether(b) && b.members.every((id) => t.members.includes(id))
  return [...binds.filter((b) => !made.some((t) => tied(b, t))), ...made]
}

function reduceGrapplesOf(action: Action, grapples: Grapple[]): Grapple[] {
  // combat.tex "Push and drag": one who let go "and leave[s] the grapple"
  // instead of being moved
  if (action.kind === 'drag') {
    const released = action.facts?.released ?? []
    return released.length === 0 ? grapples : dropHolders(grapples, (id) => released.includes(id))
  }
  const facts = getGrappleFacts(action)
  return facts ? replacePair(grapples, facts.pair, facts.grapple) : grapples
}

// The one place an action changes what lies on the floor: what a disarm
// knocked out of a hand, where its owner stands (combat.tex "Disarm"); what
// was thrown, one of it, where the throw was aimed; what was picked up,
// gone from it; what a throw moved, gone from wherever it lay and landed
// where it was aimed (combat.tex "Throw"); what a charge went off in,
// destroyed (combat.tex "Explosions"). Read off the fight as it stood
// before the action landed.
export function reduceFloor(state: SceneState, action: Action, phase: Phase): (floor: FloorItem[]) => FloorItem[] {
  return (floor: FloorItem[]) => {
    if (phase !== 'resolve') return floor
    const cellOf = (id: string | null) => (id ? state.board?.placements[id]?.cell ?? null : null)
    if (action.kind === 'grapple' && action.facts?.dropped) {
      const { ownerId, itemId } = action.facts.dropped
      const owner = state.characters[ownerId]
      const item = owner ? getHeldItem(owner, itemId) : undefined
      return item ? [...floor, onFloor(item, cellOf(ownerId))] : floor
    }
    // what a blow on an object broke; a thrown row lands where it was aimed
    if (action.kind === 'shoot') {
      const hit = isFloorAttack(action) ? withBroken(floor, action) : floor
      return action.thrown ? [...hit, onFloor(action.thrown, getGroundCell(state, action) ?? cellOf(action.targetId))] : hit
    }
    if (action.kind === 'pickUp') return withoutOne(floor, action.itemId)
    // lands where it was thrown, gone from wherever it lay before — a hand
    // leaves nothing behind on the floor
    if (action.kind === 'throw') return action.thrown ? [...withoutOne(floor, action.itemId), ...(action.thrown.fuel ? [] : [onFloor(action.thrown, action.to)])] : floor
    if (action.kind === 'explosion' && action.source !== 'cast') return withoutOne(floor, action.itemId)
    if (action.kind === 'strike' && isFloorAttack(action)) return withBroken(floor, action)
    return floor
  }
}

function withBroken(floor: FloorItem[], attack: AttackAction): FloorItem[] {
  return getBrokenItems(attack).reduce((acc, { itemId }) => breakOne(acc, itemId, attack.id), floor)
}

// combat.tex "Fire": burning damage that lands on the ground sets alight the
// fuel there, as hot as the burn it dealt (the table's ruling: only an attack
// aimed at the ground does, and a guard stops one aimed by a shot).
function lightBurned(state: SceneState, attack: AttackAction, board: Board): Board {
  const ground = getGroundCell(state, attack)
  const burn = getBurnOf(state, attack)
  if (!ground || burn <= 0 || !attack.roll || attack.roll.degree === 'miss' || isVoided(state, attack) || isStoppedByGuard(state, attack)) return board
  const key = coordKey(ground)
  return board.terrain[key] ? { ...board, terrain: { ...board.terrain, [key]: igniteCell(state, board.terrain[key], burn) } } : board
}

// combat.tex "Crash": who it stunned, and the target it knocked prone —
// "Stun: An interrupt in which the target also loses 2 AP" — and, being
// interrupted, stops concentrating.
function trampledBy(tramples: Trample[], c: CampaignCharacter, charged: boolean): CampaignCharacter {
  const hit = tramples.filter((t) => t.stunned.includes(c.id))
  if (hit.length === 0) return c
  const stunned = loseConcentration(payCost({ AP: STUN_AP * hit.length, STA: 0 }, charged)(c))
  return hit.some((t) => t.prone && t.id === c.id) ? fallProne(stunned) : stunned
}

// The one place an action changes the board, the same way: it reads the
// action and applies the part that moves anyone. Where a move ends was
// worked out from the fight as it stood at the resolve, so the board is
// handed the state it is part of.
// combat.tex "Swimming": where the swimmer ends a move they are in the water
// at the depth the dive took them, if the move went to its end, and out of the
// water at none.
function settleDepth(state: SceneState, action: MoveAction, destination: Placement): Placement {
  const mover = state.characters[action.actorId]
  if (!mover || !state.board) return destination
  const water = readWater(state.board, getFootprint(mover, destination))
  return { ...destination, depth: getDepthAfter(state, action, water, action.facts?.stop === 'end') }
}

export function reduceBoard(state: SceneState, action: Action, phase: Phase): (board: Board) => Board {
  const land = landOnBoard(state, action, phase)
  return (board) => (phase === 'resolve' ? turnToHeading(state, action, land(board)) : board)
}

// A character who covers one cell faces the way their last action went; a
// larger one turns only as its moves say, since turning moves its footprint.
function turnToHeading(state: SceneState, action: Action, board: Board): Board {
  const heading = getActionHeading(state, action, board)
  const placement = board.placements[action.actorId]
  const c = state.characters[action.actorId]
  if (heading === null || !placement || !c || getFootprint(c, placement).length > 1) return board
  return { ...board, placements: { ...board.placements, [action.actorId]: { ...placement, orientation: heading } } }
}

function landOnBoard(state: SceneState, action: Action, phase: Phase): (board: Board) => Board {
  return (board: Board) => {
    if (phase !== 'resolve') return board
    const lit = isAttackAction(action) ? lightBurned(state, action, board) : board
    if (action.kind === 'move') {
      // a mover off the board while an evader stepped out of their way is put
      // back where they stood, for the move to take them on from there
      const passing = board.placements[action.actorId] ? null : getPassingPlacement(state, action)
      const placements = passing ? { ...board.placements, [action.actorId]: passing } : board.placements
      // a jump away from an opportunity attack put the mover where it landed
      const destination = action.facts && action.facts.stop !== 'jump' ? getMoveDestination(state, action, action.facts.path) : null
      const hang = action.movement === 'climb' ? action.facts?.hang : null
      const hanging = hang && placements[action.actorId] ? { ...placements[action.actorId], elevation: hang.elevation, climb: { to: hang.to, covered: hang.covered, upright: hang.upright } } : null
      if (hanging) return { ...board, placements: { ...placements, [action.actorId]: hanging } }
      return { ...board, placements: destination ? { ...placements, [action.actorId]: settleDepth(state, action, destination) } : placements }
    }
    if (action.kind === 'strike') {
      // abilities.tex "Defender", "Defensive Advance": whoever stepped to
      // block or intercept stands where they stepped
      const stepped = Object.fromEntries(getReactionsTo(state, action.id).flatMap((r) => ((r.kind === 'block' || r.kind === 'intercept') && r.to ? [[r.actorId, r.to]] : [])))
      const placements = { ...board.placements, ...stepped }
      // combat.tex "Evasive Jump": the defender lands where the jump said
      if (!action.jumpedTo || !action.targetId) return { ...lit, placements }
      return { ...lit, placements: { ...placements, [action.targetId]: action.jumpedTo } }
    }
    // combat.tex "Balance": the faller lands where the fall took them, at the
    // height of the ground there
    if (action.kind === 'fall') {
      const placement = board.placements[action.actorId]
      return action.to && placement ? { ...board, placements: { ...board.placements, [action.actorId]: placeAt(board, placement, action.to) } } : board
    }
    // combat.tex "Push and drag": everyone moved where the block left them
    if (action.kind === 'drag') return action.facts ? { ...board, placements: { ...board.placements, ...action.facts.to } } : board
    // combat.tex "Gas", "Fire": what the explosion leaves on the ground, by
    // zone, kept by its caster when it is a sustained spell's, in place of
    // what their last cast of it left
    if (action.kind === 'blast') {
      const opener = action.spawnedBy ? getAction(state, action.spawnedBy) : null
      const heldBy = getHolderOf(state, action, opener)
      const terrain = heldBy ? filterLayers(board.terrain, (l) => !isSupersededBy(l, heldBy)) : { ...board.terrain }
      for (const { cell, hazard } of action.paint) {
        const key = coordKey(cell)
        const was = terrain[key] ?? TerrainCellSchema.parse({})
        terrain[key] = igniteCell(state, { ...was, layers: [...was.layers, HazardLayerSchema.parse({ ...hazard, heldBy })] }, hazard.fire)
      }
      return { ...board, terrain }
    }
    // combat.tex "Fire": what burned in the muffled space is out
    if (action.kind === 'extinguish' && action.to) {
      const key = coordKey(action.to)
      const was = board.terrain[key]
      return was ? { ...board, terrain: { ...board.terrain, [key]: extinguishCell(state, was) } } : board
    }
    // gear.tex "Special Items": a flask breaks where it lands and coats the space
    if (action.kind === 'throw' && action.thrown?.fuel && action.to) {
      const key = coordKey(action.to)
      return { ...board, terrain: { ...board.terrain, [key]: coatCell(state, board.terrain[key] ?? TerrainCellSchema.parse({}), action.thrown.fuel) } }
    }
    return lit
  }
}
