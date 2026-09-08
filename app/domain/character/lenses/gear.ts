import { Character, Weapon, WeaponAttack } from "../../types";
import { getBurdenPenalty } from "../../item/lenses/containers";
import { getSTR } from "./characteristics";
import { getTGH } from "./misc";
import { injuryMap } from "../../tables";

// gear.tex "Burden penalties": armor, shield and container penalties stack and
// are then "modified by (STR-10)/3". Penalties are stored as positive
// magnitudes here and negated by the AGI/STA getters that consume them, so a
// stronger character subtracts from the total. The rulebook does not state a
// rounding rule; truncating toward zero keeps the modifier symmetric for
// STR above and below 10. The total floors at 0 — carrying gear never grants
// a bonus.
export function getGearPenalties(c: Character){
  const gear = c.armor.penalty +
    Object.values(c.weapons).reduce((acc: number, weapon: Weapon) => acc + weapon.penalty, 0) +
    getBurdenPenalty(c)

  const strMod = Math.trunc((getSTR(c) - 10) / 3)

  return Math.max(0, gear - strMod)
}


// gear.tex weapon tables: a `*mod` column is a multiple of STR added to the flat
// value of its row. It is one rule with two applications — attack damage
// (STRmod on blunt) and the weapon's own durability (RESmod on RES) — so it
// lives here once and both the displayed row and the rolled attack call it.
//
// Size scaling is deliberately NOT applied here. A weapon is scaled once, at
// equip time, by `scaleWeapon`, so the stored flat value is already at the
// wielder's scale; multiplying again would double-scale it.
export function applySTRmod(value: number, mod: number, c: Character): number {
  if (mod === 0) return value
  return Math.floor(value + mod * getSTR(c))
}

// Read-side projection of one row of a weapon's attack table. Every number is
// final — the component renders it, it does not compute it.
export type WeaponAttackRow = {
  RES: number
  blunt: number
  cut: number
  AP: number
  reload: number
  range: string
  deflection: number
  properties: string
  attack: WeaponAttack
}

export function getWeaponAttackRows(weapon: Weapon): (c: Character) => WeaponAttackRow[] {
  return (c: Character) =>
    weapon.attacks.map((atk) => ({
      RES: applySTRmod(atk.RES, atk.RESmod, c),
      blunt: applySTRmod(atk.blunt, atk.STRmod, c),
      // Only blunt rows carry STR multiples in the gear.tex tables.
      cut: atk.cut,
      AP: atk.AP,
      reload: atk.reload,
      range: atk.range,
      deflection: atk.deflection,
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
