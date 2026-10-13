import { isCombatStarted } from './started'
import type { CampaignCharacter, Character, Item } from '../../types'
import type { ActionOf, SceneState } from '../types'
import { canAffordOrHold } from '../../character/rules/cost'
import { getReloadCost, needsReload } from '../../character/rules/gear'
import { getAmmoStackName, getLoadableAmmo } from '../../item/rules/ammo'
import { findWeaponRow, getRowStack, getWeaponRows, type WeaponRow } from './weaponRow'
import { getRowState, type RowState } from './attack'
import { isSeizedUse } from './grapple'

// gear.tex "Reload": "The weapon requires reloading to attack again". A
// reload takes one arrow or bolt from a quick slot and leaves it in the
// weapon for the next shot. It is part of the shot (the table's ruling): it
// is barred by whatever bars the shot but being empty — the focus surge
// among it (combat.tex "Focus surge") — and draws opportunity attacks as a
// ranged attack does (combat.tex "Opportunity Attack").

// Every row in hand that fires what a reload put in it.
export function getReloadRows(c: Character): WeaponRow[] {
  return getWeaponRows(c).filter((row) => needsReload(row.atk))
}

// The row a reload names, while it still is one that is reloaded.
export function getReloadRow(c: Character, action: ActionOf<'reload'>): WeaponRow | null {
  const row = findWeaponRow(c, action.weaponKey, action.attack)
  return row && needsReload(row.atk) ? row : null
}

const SHOT_BARS: Record<Exclude<RowState, 'empty'>, string> = { closed: 'cannot be used', unfocused: 'needs a focus surge', open: 'already loaded', unloaded: 'already loaded' }

// Why the row cannot be reloaded right now, or null.
export function getReloadBar(state: SceneState, c: CampaignCharacter, row: WeaponRow): string | null {
  const shot = getRowState(c, row, 'shoot', isCombatStarted(state))
  if (shot !== 'empty') return SHOT_BARS[shot]
  if (isSeizedUse(state, c.id, row.wielded.key, row.atk.name, null)) return 'seized'
  if (getLoadableAmmo(c, row.weapon, row.atk).length === 0) return `no ${row.atk.ammo}s in a quick slot`
  return canAffordOrHold(c, getReloadCost(row.atk, c), isCombatStarted(state)) ? null : 'cannot afford'
}

// What the weapon holds once the reload lands: one of the stack it names.
export function getReloaded(c: Character, action: ActionOf<'reload'>): NonNullable<Item['loaded']> | null {
  const row = getReloadRow(c, action)
  const stack = row ? getRowStack(c, row, action.ammoId) : null
  return stack ? { refId: stack.item.refId, name: getAmmoStackName(stack) } : null
}
