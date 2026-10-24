import { AttackType, Character, Weapon, WeaponAttack, WeaponProperty, Edge } from "../../types";
import { getSTR } from "./characteristics";
import { getSize, getDM } from "./size";
import { BOWS, DISTANCE_FREE, SHARP_HOP, SLICE_DM, SMASH_DM, DISTANCE_PENALTY_CAP_STEPS, DISTANCE_STEP, RMArr, SHOTS, ShotKind, dmgArr } from "../../tables";
import { ActionCost, getActionCost } from "./actionCosts";
import { getAttackKind, getAttackType, getHeavyRange, getRangeMetres, hasProperty, canSharpen, isSharpEdge } from "../../weaponProperties";
import { getBuffBonus } from "./effects";
import { hasGrant } from "./effects"
import { isCampaignCharacter } from "../../utils";

// gear.tex "Size Scaling": "Wielding a weapon that is larger than appropriate
// increases the cost of AP for all attacks by +1, and uses STR-5 in the
// contribution of STR to damage. This penalty applies to any contribution of
// STR for any attack, including braced, hooked, and heavy. Wielding a weapon
// 2 size categories larger is impossible." The hands may still hold such a
// weapon — holding goes by bulk (gear.tex "Hands") — it just cannot be fought
// with.
export function isOversize(weapon: Weapon, c: Character): boolean {
  return weapon.scale > getSize(c)
}

export function isWieldable(weapon: Weapon, c: Character): boolean {
  return weapon.scale <= getSize(c) + 1
}

// The STR that goes into this weapon's damage.
function getWieldSTR(weapon: Weapon, c: Character): number {
  return getSTR(c) - (isOversize(weapon, c) ? 5 : 0)
}

// combat.tex "Success Overflow", "Slice": "increase cutting damage by 5xDM",
// for every slice bought.
export function getSliceBonus(times: number, c: Character): number {
  return times * Math.floor(SLICE_DM * getDM(c))
}

// combat.tex "Success Overflow", "Smash": "Increases blunt damage by 1xDM per
// HOP".
export function getSmashBonus(HOP: number, c: Character): number {
  return Math.floor(HOP * SMASH_DM * getDM(c))
}

// gear.tex "Gear condition": "Sharp - Bladed weapon gets +x HOP on a hit".
export function getEdgeHOP(properties: readonly WeaponProperty[], edge: Edge | null): number {
  return isSharpEdge(edge) && canSharpen(properties) ? SHARP_HOP[edge] : 0
}

// combat.tex "Braced Attack": "damage bonus of +1.5x STR x DM on a hit".
export function getBracedBonus(weapon: Weapon, c: Character): number {
  return Math.floor(1.5 * getWieldSTR(weapon, c) * getDM(c))
}

// combat.tex "Hook Attack": the trip "gets +STR/2 x DM damage if the opponent
// attempts to perform an evasive jump and +STR x DM if they are running".
export function getHookBonus(weapon: Weapon, c: Character, target: 'running' | 'jumping' | null): number {
  const multiplier = target === 'running' ? 1 : target === 'jumping' ? 0.5 : 0
  return Math.floor(multiplier * getWieldSTR(weapon, c) * getDM(c))
}

export function getAPSurcharge(weapon: Weapon, c: Character): number {
  return isOversize(weapon, c) ? 1 : 0
}

// gear.tex "DEF": "The blocking value is equal to 2x STR if weapon is one
// handed, and 4x STR if two handed or a shield. This value scales with weapon
// size" — by the weapon's own DM. It serves block and guard alike. A row
// without DEF cannot block at all, which null carries out to the panel.
export function getBlockValue(atk: WeaponAttack, weapon: Weapon, c: Character): number | null {
  if (!hasProperty(atk.properties, 'DEF')) return null
  const multiplier = atk.handed === 'two' || weapon.shield !== undefined ? 4 : 2
  return Math.floor(multiplier * getSTR(c) * dmgArr[weapon.scale - 1])
}

// combat.tex "Strike": a strike is a melee weapon attack, and it is the strike
// that carries the wielder's strength: 0.5 x STR x DM — current STR, the
// wielder's DM — on blunt and cut alike. A shot or a throw does not get it,
// and neither does a grapple I, which gear.tex "Grapple I/II" says deals no
// damage; a grapple II "deals damage normally" and so is a strike.
export function isStrike(atk: WeaponAttack): boolean {
  return getAttackKind(atk.range) === 'melee' && !hasProperty(atk.properties, 'grapple I')
}

export type Damage = { blunt: number; cut: number }

export function getStrikeDamage(atk: WeaponAttack, weapon: Weapon, c: Character): Damage {
  const bonus = isStrike(atk) ? Math.floor(0.5 * getWieldSTR(weapon, c) * getDM(c)) : 0
  return { blunt: atk.blunt + bonus, cut: atk.cut + bonus }
}

// combat.tex "Focus surge": "this surge is required to use ranged attacks" —
// a shot or a throw. Only in a combat that has started (`charged`) is there a
// surge to have made; anywhere else nothing is withheld.
export function needsFocus(atk: WeaponAttack, c: Character, charged: boolean): boolean {
  return charged && getAttackKind(atk.range) !== 'melee' && isCampaignCharacter(c) && c.usedSurge !== 'focus'
}

// gear.tex "Reload": "The weapon requires reloading to attack again" — a
// row with the property that shoots ammunition fires what a reload put into
// the weapon, not what is in the quiver.
export function needsReload(atk: WeaponAttack): boolean {
  return hasProperty(atk.properties, 'reload') && atk.ammo !== undefined
}

// gear.tex Ranged Weapons table, "4+4": the second term of the AP column,
// moved by abilities ("Quick Reload": "Reloads weapons 1|2 AP faster") and
// never below free; nothing on a row without the property.
export function getReloadCost(atk: WeaponAttack, c: Character): ActionCost {
  if (!hasProperty(atk.properties, 'reload')) return { AP: 0, STA: 0 }
  const ability = getActionCost(c, 'reload')
  return { AP: Math.max(0, (atk.reload ?? 0) + ability.AP), STA: ability.STA }
}

// abilities.tex "Archer": "Bows require training to be used effectively.
// Characters without proper training spend an extra 3 AP for each shot and
// cannot snipe or quick shot."
function isUntrainedBow(weapon: Weapon, c: Character): boolean {
  return (BOWS as readonly string[]).includes(weapon.name) && !hasGrant(c, 'bowTraining')
}

export type AttackVariant = {
  type: AttackType
  name: string
  AP: number
  STA:number
  penalty: number
  blunt: number
  cut: number
  // how far a shot carries, in metres; null for anything but a shot, whose
  // reach is the row's own (gear.tex "Short, Long I/II")
  reach: number | null
  // the penalty a shot takes per step of distance to its target; null for anything but a shot
  distance: number | null
}

// The way of shooting a variation of a shoot row is, by the name the list
// gives it; null for a variation that is not one.
export function getShotKind(variant: string): ShotKind | null {
  return (Object.keys(SHOTS) as ShotKind[]).find((kind) => SHOTS[kind].variant === variant) ?? null
}

// creating.tex "Reach Multiplier (RM): multiplies the range of all weapons":
// the metres a shooting row carries, at its weapon's scale.
export function getShotReach(atk: WeaponAttack, weapon: Weapon): number {
  return (getRangeMetres(atk.range) ?? 0) * RMArr[weapon.scale - 1]
}

// combat.tex "Shoot", "Quick Shot", "Snipe": the penalty a way of shooting
// takes per step of distance, moved by the shooter's abilities (abilities.tex "Quick
// Shooter": "Reduces distance penalty of quick shots to -2").
export function getShotDistanceRate(kind: ShotKind, c: Character): number {
  return Math.max(0, SHOTS[kind].distance + getBuffBonus(c, `distance:${kind}`))
}

// combat.tex "Distance penalty": none under 10m, then a step every 20m —
// at 10m, 30m and 50m — and "Ranged attacks outside the combat area": "3x
// the shot's distance penalty", where it stops growing.
export function getDistancePenalty(rate: number, metres: number): number {
  return metres < DISTANCE_FREE ? 0 : rate * Math.min(DISTANCE_PENALTY_CAP_STEPS, Math.floor((metres - DISTANCE_FREE) / DISTANCE_STEP) + 1)
}

// combat.tex "Heavy Attack". Degree n adds n/2 x STR x DM to damage; the
// to-hit penalty is not a formula, so it is tabulated. The AP/STA price sits
// with the other action prices in ACTION_COSTS.
const HEAVY_DEGREES: Record<number, { penalty: number; STRmul: number }> = {
  1: { penalty: 0, STRmul: 0.5 },
  2: { penalty: 2, STRmul: 1 },
  3: { penalty: 3, STRmul: 1.5 },
}
const HEAVY_ACTIONS = ['heavy1', 'heavy2', 'heavy3'] as const

// combat.tex "Sweeping Attack", made as the normal attack or as any heavy
// one the row offers ("The variations can be combined, but braced and hook
// attack cannot be combined with anything").
const SWEEP = 'sweep'

export function isSweepVariant(variant: string): boolean {
  return variant === SWEEP || variant.endsWith(`+${SWEEP}`)
}

export function getAttacksList ({ atk, weapon }: { atk: WeaponAttack; weapon: Weapon }): (c: Character) => AttackVariant[] {
  const heavyRange = getHeavyRange(atk)
  const kind = getAttackKind(atk.range)
  const type = getAttackType(atk.range)

  return((c:Character) => {
    // Every STR contribution to damage is scaled by DM (creating.tex "Damage
    // Multiplier"), and every variation is a delta on the normal attack
    // (combat.tex "Strike"), so they all start from its damage, not the row's.
    const STRxDM = getWieldSTR(weapon, c) * getDM(c)
    const untrained = kind === 'shoot' && isUntrainedBow(weapon, c)
    const AP = atk.AP + getAPSurcharge(weapon, c) + (untrained ? 3 : 0)
    const { blunt, cut } = getStrikeDamage(atk, weapon, c)
    // combat.tex "Heavy Attack": "Bonus applies to blunt damage and cutting damage."
    const plus = (bonus: number): Damage => ({ blunt: blunt + bonus, cut: cut + bonus })

    const heavy = (degree: number): AttackVariant => {
      const { penalty, STRmul } = HEAVY_DEGREES[degree]
      const cost = getActionCost(c, HEAVY_ACTIONS[degree - 1])
      return {
        name: `heavy${'I'.repeat(degree)}`,
        type,
        AP: AP + cost.AP,
        STA: cost.STA,
        penalty,
        ...plus(Math.floor(STRmul * STRxDM)),
        reach: null,
        distance: null,
      }
    }

    // Variation prices are deltas on the row's AP (combat.tex "Strike").
    const quickCost = getActionCost(c, 'quickShot')
    const snipeCost = getActionCost(c, 'snipe')
    // combat.tex "Throw": a throw carries the row's own figure, at the
    // weapon's scale ("Throwable weapons gain range based on STR" names no
    // formula, so none is applied), and "Accuracy" charges it the distance
    // penalty a shot is charged.
    const shooting = kind === 'shoot' || kind === 'throw'
    const reach = shooting ? getShotReach(atk, weapon) : null
    const distance = (shot: ShotKind) => (shooting ? getShotDistanceRate(shot, c) : null)
    const basic: AttackVariant = { name: SHOTS.shoot.variant, type, AP, STA: 0, penalty: 0, blunt, cut, reach, distance: distance('shoot') }
    // combat.tex "Braced Attack", "Hook Attack": declared at the normal
    // attack's price; what they add is bought after the hit
    const braced: AttackVariant = { ...basic, name: 'braced', reach: null, distance: null }
    const hook: AttackVariant = { ...basic, name: 'hook', reach: null, distance: null }
    // combat.tex "Quick Shot": cheaper, at a steeper distance penalty.
    const quickShot: AttackVariant = { name: SHOTS.quickShot.variant, type, AP: AP + quickCost.AP, STA: quickCost.STA, penalty: 0, blunt, cut, reach, distance: distance('quickShot') }
    const snipe: AttackVariant = { name: SHOTS.snipe.variant, type, AP: AP + snipeCost.AP, STA: snipeCost.STA, penalty: 0, blunt, cut, reach, distance: distance('snipe') }

    const attacks: AttackVariant[] = []

    // gear.tex "Heavy I/II/III": a heavy range ("heavy I-II") sets its lower
    // bound as the minimum and forbids the normal attack; a bare degree keeps
    // it. `min === 0` carries that distinction out of getHeavyRange.
    if (!heavyRange || heavyRange.min === 0) attacks.push(basic)
    if (heavyRange) {
      for (let degree = Math.max(1, heavyRange.min); degree <= heavyRange.max; degree++) {
        attacks.push(heavy(degree))
      }
    }

    // combat.tex "Sweeping Attack": "spends 1 additional AP on the attack"
    if (kind === 'melee' && hasProperty(atk.properties, 'sweeping')) {
      const sweepCost = getActionCost(c, 'sweep')
      attacks.push(...attacks.map((v) => ({ ...v, name: v.name === basic.name ? SWEEP : `${v.name}+${SWEEP}`, AP: v.AP + sweepCost.AP, STA: v.STA + sweepCost.STA })))
    }
    if (hasProperty(atk.properties, 'braced')) attacks.push(braced)
    if (hasProperty(atk.properties, 'hook')) attacks.push(hook)
    // combat.tex "Snipe", "Quick Shot" modify Shoot; gear.tex "STR x": "Cannot
    // use quick shot unless STR is +3 points higher than the requirement."
    if (kind === 'shoot' && !untrained) {
      if (atk.STRreq === undefined || getSTR(c) >= atk.STRreq + 3) attacks.push(quickShot)
      attacks.push(snipe)
    }

    return attacks
  })
}
