import type { AttackKind, AttackType, Character, Handed, Material, Range, Weapon, WeaponAttack } from '../../types'
import { getWieldedWeapons, isAttackUsable } from '../../item/rules/hands'
import { getHardness } from '../../item/rules/items'
import { injuryMap } from '../../tables'
import { getAttackKind, getAttackPropertyLabels, getAttackType, hasProperty } from '../../weaponProperties'
import { getActionCost } from '../rules/actionCosts'
import { getArmor } from '../rules/armor'
import { AttackVariant, getAPSurcharge, getAttacksList, getBlockValue, getStrikeDamage, isOversize, isWieldable, needsFocus } from '../rules/gear'
import { getTGH } from '../rules/misc'

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
  material: Material
  hardness: number
  // The properties cell as printed: the listed properties, heavy, STR x.
  properties: string[]
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
      material: atk.material,
      hardness: getHardness(atk.material),
      properties: getAttackPropertyLabels(atk),
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
}

export function getDamageTiers(c: Character): DamageTierRow[] {
  const TGH = getTGH(c)
  const armor = getArmor(c)

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
    }
  })
}

export type WeaponPanelRow = WeaponAttackRow & {
  // gear.tex "Small/One/Two hands": a two-handed row needs both hands on the
  // weapon. A row the grip does not allow, or a weapon too large to wield,
  // keeps its numbers and fires nothing.
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
  // gear.tex "Size Scaling": two or more above, and unusable in the hands.
  wieldable: boolean
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
    wieldable: isWieldable(weapon, c),
    grip,
    itemId,
    natural,
    shield: weapon.shield ? { cover: weapon.shield.cover, body: weapon.shield.body } : null,
    rows: getWeaponAttackRows(weapon)(c).map((row) => {
      const usable = isWieldable(weapon, c) && isAttackUsable(row.handed, grip)
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
        panel.wieldable,
        panel.grip,
        panel.itemId,
        panel.natural,
        panel.shield ? `${panel.shield.cover}/${panel.shield.body}` : '',
        panel.rows
          .map((r) =>
            [r.name, r.kind, r.handed, r.usable, r.needsFocus, r.RES, r.blunt, r.cut, r.AP, r.reload, r.range, r.block, r.STRreq, r.properties.join('/'),
             r.variants.map((v) => `${v.name}/${v.type}/${v.AP}/${v.STA}/${v.penalty}/${v.blunt}/${v.cut}/${v.reach}`).join('~')]
              .join(','),
          )
          .join(';'),
      ].join('|'),
    )
    .join('||')
}
