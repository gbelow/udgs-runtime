import { AttackKind, AttackType, Character, Handed, Range, Weapon, WeaponAttack, WeaponProperty } from "../../types";
import { getBurdenPenalty } from "../../item/lenses/containers";
import { getWieldedWeapons, isAttackUsable } from "../../item/lenses/hands";
import { getSTR, getSTRBase } from "./characteristics";
import { getSize, getTGH } from "./misc";
import { dmgArr, injuryMap } from "../../tables";
import { getActionCost } from "./actionCosts";
import { getDM } from "./helpers";
import { getAttackKind, getAttackType, getHeavyRange, hasProperty } from "../../weaponProperties";
import { isCampaignCharacter } from "../../utils";

// gear.tex "Burden penalties": armor, shield and container penalties stack and
// are then "modified by (STR-10)/5". Penalties are stored as positive
// magnitudes here and negated by the AGI/STA getters that consume them, so a
// stronger character subtracts from the total. The rulebook does not state a
// rounding rule; truncating toward zero keeps the modifier symmetric for
// STR above and below 10. The total floors at 0 — carrying gear never grants
// a bonus. STR is read unpenalized here: this value feeds AGI/STA, which the
// injury penalty already reduces on its own.
export function getGearPenalties(c: Character){
  const gear = c.armor.burdenPenalty +
    getWieldedWeapons(c).reduce((acc: number, { weapon }) => acc + (weapon.shield?.burdenPenalty ?? 0), 0) +
    getBurdenPenalty(c)

  const strMod = Math.trunc((getSTRBase(c) - 10) / 5)

  return Math.max(0, gear - strMod)
}


// gear.tex "Size Scaling": "Wielding a weapon that is larger than appropriate
// increases the cost of AP for all attacks by +1, and uses STR-5 in the
// contribution of STR to damage. This penalty applies to any contribution of
// STR for any attack, including braced, hooked, and heavy." Two sizes larger
// is already unholdable (gear.tex "Hands"), so this is the one-step case.
export function isOversize(weapon: Weapon, c: Character): boolean {
  return weapon.scale > getSize(c)
}

// The STR that goes into this weapon's damage.
function getWieldSTR(weapon: Weapon, c: Character): number {
  return getSTR(c) - (isOversize(weapon, c) ? 5 : 0)
}

function getAPSurcharge(weapon: Weapon, c: Character): number {
  return isOversize(weapon, c) ? 1 : 0
}

// gear.tex "DEF": "The blocking value is equal to STR if weapon is one handed,
// and 2x STR if two handed or a shield. This value scales with weapon size."
// — by the weapon's own DM. A row without DEF cannot block at all, which null
// carries out to the panel.
export function getBlockValue(atk: WeaponAttack, weapon: Weapon, c: Character): number | null {
  if (!hasProperty(atk.properties, 'DEF')) return null
  const hands = atk.handed === 'two' || weapon.shield !== undefined ? 2 : 1
  return Math.floor(hands * getSTR(c) * dmgArr[weapon.scale - 1])
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

// combat.tex "Shoot": "Requires Focus surge to use." A throw does not. On the
// sheet there is no surge to have used, so nothing is withheld there.
export function needsFocus(atk: WeaponAttack, c: Character): boolean {
  return getAttackKind(atk.range) === 'shoot' && isCampaignCharacter(c) && c.usedSurge !== 'focus'
}

// Read-side projection of one row of a weapon's attack table. Every number is
// final — the component renders it, it does not compute it.
export type WeaponAttackRow = {
  name: string
  type: AttackType
  kind: AttackKind
  handed: Handed
  RES: number
  blunt: number
  cut: number
  AP: number
  reload: number
  range: Range
  block: number | null
  STRreq: number | null
  // combat.tex "Shoot": a shot this character has not surged focus for.
  needsFocus: boolean
  properties: WeaponProperty[]
  attack: WeaponAttack
}

export function getWeaponAttackRows(weapon: Weapon): (c: Character) => WeaponAttackRow[] {
  return (c: Character) =>
    weapon.attacks.map((atk) => ({
      name: atk.name,
      type: getAttackType(atk.range),
      kind: getAttackKind(atk.range),
      handed: atk.handed,
      RES: atk.RES,
      // The damage the normal attack deals, STR included — not the bare row.
      ...getStrikeDamage(atk, weapon, c),
      AP: atk.AP + getAPSurcharge(weapon, c),
      // gear.tex "Reload": the row's own figure, moved by abilities and never
      // below free; a row without the property stays at 0 whatever it stores.
      reload: hasProperty(atk.properties, 'reload') ? Math.max(0, (atk.reload ?? 0) + getActionCost(c, 'reload').AP) : 0,
      range: atk.range,
      block: getBlockValue(atk, weapon, c),
      STRreq: atk.STRreq ?? null,
      needsFocus: needsFocus(atk, c),
      properties: atk.properties,
      attack: atk,
    }))
}

// combat.tex "Damage Tiers". The threshold for tier n is `armor + n x TGH`,
// where `armor` is the armor value for the damage type being defended against:
// protection vs blunt, RES vs piercing, INS vs burn (combat.tex "Types of
// damage"). IL and wound chance per tier come from the same table.
export type DamageTierRow = {
  tier: number
  blunt: number
  RES: number
  INS: number
  IL: number
  woundChance: number
}

export function getDamageTiers(c: Character): DamageTierRow[] {
  const TGH = getTGH(c)
  const armor = c.armor

  // The tier number comes from the injuryMap key (T0..T6), not from the entry's
  // position, so reordering or inserting an entry can't silently shift every
  // threshold by one tier.
  return Object.entries(injuryMap).map(([key, effect]) => {
    const tier = Number(key.slice(1))
    return {
      tier,
      blunt: armor.protection + tier * TGH,
      RES: armor.RES + tier * TGH,
      INS: armor.INS + tier * TGH,
      IL: effect.IL,
      woundChance: effect.woundChance,
    }
  })
}

export type AttackVariant = {
  type: AttackType
  name: string
  AP: number
  STA:number
  penalty: number
  blunt: number
  cut: number
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

export function getAttacksList ({ atk, weapon }: { atk: WeaponAttack; weapon: Weapon }): (c: Character) => AttackVariant[] {
  const heavyRange = getHeavyRange(atk.properties)
  const has = (property: WeaponProperty) => hasProperty(atk.properties, property)
  const kind = getAttackKind(atk.range)
  const type = getAttackType(atk.range)

  return((c:Character) => {
    // Every STR contribution to damage is scaled by DM (creating.tex "Damage
    // Multiplier"), and every variation is a delta on the normal attack
    // (combat.tex "Strike"), so they all start from its damage, not the row's.
    const STRxDM = getWieldSTR(weapon, c) * getDM(c)
    const AP = atk.AP + getAPSurcharge(weapon, c)
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
      }
    }

    // Variation prices are deltas on the row's AP (combat.tex "Strike").
    const bracedCost = getActionCost(c, 'braced')
    const quickCost = getActionCost(c, 'quickShot')
    const snipeCost = getActionCost(c, 'snipe')
    const basic: AttackVariant = { name: 'basic', type, AP, STA: 0, penalty: 0, blunt, cut }
    // combat.tex "Braced Attack": "+1.5x STR x DM on a hit".
    const braced: AttackVariant = { name: 'braced', type, AP: AP + bracedCost.AP, STA: bracedCost.STA, penalty: 0, ...plus(Math.floor(1.5 * STRxDM)) }
    const hook: AttackVariant = { name: 'hook', type, AP, STA: 0, penalty: 0, blunt, cut }
    // combat.tex "Quick Shot": cheaper and range-limited, with no penalty to hit.
    const quickShot: AttackVariant = { name: 'quick', type, AP: AP + quickCost.AP, STA: quickCost.STA, penalty: 0, blunt, cut }
    const snipe: AttackVariant = { name: 'snipe', type, AP: AP + snipeCost.AP, STA: snipeCost.STA, penalty: 0, blunt, cut }

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

    if (has('braced')) attacks.push(braced)
    if (has('hook')) attacks.push(hook)
    // combat.tex "Snipe", "Quick Shot" modify Shoot; gear.tex "STR x": "Cannot
    // use quick shot unless STR is +3 points higher than the requirement."
    if (kind === 'shoot') {
      if (atk.STRreq === undefined || getSTR(c) >= atk.STRreq + 3) attacks.push(quickShot)
      attacks.push(snipe)
    }

    return attacks
  })
}

export type WeaponPanelRow = WeaponAttackRow & {
  // gear.tex "Small/One/Two hands": a two-handed row needs both hands on the
  // weapon. A row the grip does not allow keeps its numbers and fires nothing.
  usable: boolean
  // The attack variants this row can fire, already priced against the wielder.
  variants: AttackVariant[]
}

export type WeaponPanelView = {
  key: string
  name: string
  scale: number
  // gear.tex "Size Scaling": one size above the wielder, and priced for it.
  oversize: boolean
  grip: number
  // '' for a natural weapon: the free hands themselves, not a held item.
  itemId: string
  natural: boolean
  // gear.tex "Shields": the cover a shield adds to a block or guard, and
  // whether it is a body shield; null for anything that is not a shield.
  shield: { cover: number; body: boolean } | null
  rows: WeaponPanelRow[]
}

// The whole weapon panel in one shape: every weapon in the hands, its rows,
// and the variants each row can fire. One getter means the UI needs no
// per-weapon lookup back into the character, so nothing on the render path
// reads state it has not subscribed to.
export function getWeaponPanels(c: Character): WeaponPanelView[] {
  return getWieldedWeapons(c).map(({ key, weapon, grip, itemId, natural }) => ({
    key,
    name: weapon.name,
    scale: weapon.scale,
    oversize: isOversize(weapon, c),
    grip,
    itemId,
    natural,
    shield: weapon.shield ? { cover: weapon.shield.cover, body: weapon.shield.body } : null,
    rows: getWeaponAttackRows(weapon)(c).map((row) => {
      const usable = isAttackUsable(row.handed, grip)
      return {
        ...row,
        usable,
        variants: usable && !row.needsFocus ? getAttacksList({ atk: row.attack, weapon })(c) : [],
      }
    }),
  }))
}

// Everything the panel displays, as one string — the gate for a shape that is
// freshly allocated on every call. Takes the panels rather than the character so
// it digests the output, not a second derivation of it (cf. termsDigest).
export function getWeaponPanelsDigest(panels: WeaponPanelView[]): string {
  return panels
    .map((panel) =>
      [
        panel.key,
        panel.name,
        panel.scale,
        panel.oversize,
        panel.grip,
        panel.itemId,
        panel.natural,
        panel.shield ? `${panel.shield.cover}/${panel.shield.body}` : '',
        panel.rows
          .map((r) =>
            [r.name, r.kind, r.handed, r.usable, r.needsFocus, r.RES, r.blunt, r.cut, r.AP, r.reload, r.range, r.block, r.STRreq, r.properties.join('/'),
             r.variants.map((v) => `${v.name}/${v.type}/${v.AP}/${v.STA}/${v.penalty}/${v.blunt}/${v.cut}`).join('~')]
              .join(','),
          )
          .join(';'),
      ].join('|'),
    )
    .join('||')
}
