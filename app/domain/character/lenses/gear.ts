import { Character, Handed, Range, Weapon, WeaponAttack, WeaponProperty } from "../../types";
import { getBurdenPenalty } from "../../item/lenses/containers";
import { getWieldedWeapons, isAttackUsable } from "../../item/lenses/hands";
import { getSTR, getSTRBase } from "./characteristics";
import { getTGH } from "./misc";
import { injuryMap } from "../../tables";
import { getActionCost } from "./actionCosts";
import { getHeavyRange, hasProperty } from "../../weaponProperties";

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


// gear.tex "DEF": "The blocking value is equal to STR if weapon is one handed,
// and 2x STR if two handed or a shield." A row without DEF cannot block at
// all, which null carries out to the panel.
export function getBlockValue(atk: WeaponAttack, shield: boolean, c: Character): number | null {
  if (!hasProperty(atk.properties, 'DEF')) return null
  return atk.handed === 'two' || shield ? 2 * getSTR(c) : getSTR(c)
}

// Read-side projection of one row of a weapon's attack table. Every number is
// final — the component renders it, it does not compute it.
export type WeaponAttackRow = {
  name: string
  handed: Handed
  RES: number
  blunt: number
  cut: number
  AP: number
  reload: number
  range: Range
  block: number | null
  STRreq: number | null
  properties: WeaponProperty[]
  attack: WeaponAttack
}

export function getWeaponAttackRows(weapon: Weapon): (c: Character) => WeaponAttackRow[] {
  return (c: Character) =>
    weapon.attacks.map((atk) => ({
      name: atk.name,
      handed: atk.handed,
      RES: atk.RES,
      blunt: atk.blunt,
      cut: atk.cut,
      AP: atk.AP,
      // gear.tex "Reload": the row's own figure, moved by abilities and never
      // below free; a row without the property stays at 0 whatever it stores.
      reload: hasProperty(atk.properties, 'reload') ? Math.max(0, (atk.reload ?? 0) + getActionCost(c, 'reload').AP) : 0,
      range: atk.range,
      block: getBlockValue(atk, weapon.shield !== undefined, c),
      STRreq: atk.STRreq ?? null,
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
  // gear.tex "Rigid armors": when RES is given as two numbers the second is the
  // inner layer. 0 means the armor has no second layer.
  RESlayer: number
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
      RESlayer: armor.RESlayer > 0 ? armor.RESlayer + tier * TGH : 0,
      INS: armor.INS + tier * TGH,
      IL: effect.IL,
      woundChance: effect.woundChance,
    }
  })
}

export type AttackVariant = {
  type: string
  name: string
  AP: number
  STA:number
  penalty: number
  blunt: number
  cut: number
}

// gear.tex "Heavy I/II/III". Degree n adds n/2 x STR to damage; the to-hit
// penalty is not a formula, so it is tabulated. The AP/STA price sits with
// the other action prices in ACTION_COSTS.
const HEAVY_DEGREES: Record<number, { penalty: number; STRmul: number }> = {
  1: { penalty: 0, STRmul: 0.5 },
  2: { penalty: 2, STRmul: 1 },
  3: { penalty: 3, STRmul: 1.5 },
}
const HEAVY_ACTIONS = ['heavy1', 'heavy2', 'heavy3'] as const

export function getAttacksList ({atk} : {atk: WeaponAttack }) : (c: Character) => AttackVariant[] {
  const heavyRange = getHeavyRange(atk.properties)
  const has = (property: WeaponProperty) => hasProperty(atk.properties, property)

  return((c:Character) => {
    const STR = getSTR(c)
    const { blunt, cut } = atk

    // A heavy attack adds the same STR multiple to both damage components, but
    // only to a component the attack actually has — a weapon with no cut stays
    // at 0 rather than becoming a cutting weapon at higher degrees.
    const heavy = (degree: number): AttackVariant => {
      const { penalty, STRmul } = HEAVY_DEGREES[degree]
      const { AP, STA } = getActionCost(c, HEAVY_ACTIONS[degree - 1])
      const bonus = Math.floor(STRmul * STR)
      return {
        name: `heavy${'I'.repeat(degree)}`,
        type: 'melee',
        AP: atk.AP + AP,
        STA,
        penalty,
        blunt: blunt + bonus,
        cut: cut ? cut + bonus : 0,
      }
    }

    // Variation prices are deltas on the row's AP (combat.tex "Strike").
    const bracedCost = getActionCost(c, 'braced')
    const quickCost = getActionCost(c, 'quickShot')
    const snipeCost = getActionCost(c, 'snipe')
    const basic = {name: 'basic', type: 'melee', AP: atk.AP, STA:0, penalty: 0, blunt, cut }
    const braced = {name: 'braced', type: 'melee', AP: atk.AP + bracedCost.AP, STA: bracedCost.STA, penalty: 0, blunt: blunt+ Math.floor(STR), cut: cut ? cut+ Math.floor(STR) : 0}
    const hook = {name: 'hook', type: 'melee', AP: atk.AP, STA:0, penalty: 0, blunt, cut }
    // combat.tex "Quick Shot": cheaper and range-limited, with no penalty to hit.
    const quickShot = {name: 'quick', type: 'ranged', AP: atk.AP + quickCost.AP, STA: quickCost.STA, penalty: 0, blunt, cut }
    const snipe = {name: 'snipe', type: 'ranged', AP: atk.AP + snipeCost.AP, STA: snipeCost.STA, penalty: 0, blunt, cut }

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
    if (has('fast')) attacks.push(quickShot, snipe)

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
    grip,
    itemId,
    natural,
    shield: weapon.shield ? { cover: weapon.shield.cover, body: weapon.shield.body } : null,
    rows: getWeaponAttackRows(weapon)(c).map((row) => {
      const usable = isAttackUsable(row.handed, grip)
      return {
        ...row,
        usable,
        variants: usable ? getAttacksList({ atk: row.attack })(c) : [],
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
        panel.grip,
        panel.itemId,
        panel.natural,
        panel.shield ? `${panel.shield.cover}/${panel.shield.body}` : '',
        panel.rows
          .map((r) =>
            [r.name, r.handed, r.usable, r.RES, r.blunt, r.cut, r.AP, r.reload, r.range, r.block, r.STRreq, r.properties.join('/'),
             r.variants.map((v) => `${v.name}/${v.type}/${v.AP}/${v.STA}/${v.penalty}/${v.blunt}/${v.cut}`).join('~')]
              .join(','),
          )
          .join(';'),
      ].join('|'),
    )
    .join('||')
}
