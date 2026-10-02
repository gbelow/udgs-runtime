import type { CampaignCharacter } from '../../types'
import type { CombatState, CutAction, StrikeAction, Tether } from '../types'
import { getBreakChance } from '../../character/rules/breakage'
import { getStrikeDamage } from '../../character/rules/gear'
import { getHardness, getItemWeapon } from '../../item/rules/items'
import { getHeldItem } from '../../item/rules/hands'
import { explodes } from '../../weaponProperties'
import { makeAction } from '../factories'
import { isInReach } from './board'
import { getTethers, getTethersOf } from './partners'
import { findWeaponRow } from './weaponRow'
import { isWon } from './test'

// gear.tex "Equipment Breakage"; combat.tex "Attack against equipment": a cut
// is swung with a weapon row like a strike, at one end of a net's tether, and
// scored against no defense (the table's ruling: DL 0).

export const CUT_DL = [{ label: 'net', value: 0 }]

// The strike a cut is made as: the same row, reach and skill, aimed at the
// character at that end.
export function getCutStrike(root: CutAction): StrikeAction {
  return makeAction('strike', { id: root.id, actorId: root.actorId, targetId: root.targetId, weaponKey: root.weaponKey, attack: root.attack, variant: root.variant })
}

// Every character at the end of a tether the cutter's row reaches.
export function getCutTargets(state: CombatState, root: CutAction): string[] {
  const strike = getCutStrike(root)
  return Object.keys(state.characters).filter((id) => id !== root.actorId && getTethersOf(state, id).length > 0 && isInReach(state, strike, id))
}

// The net the target is tied by is one thing: every tether that holder made
// with it ends together when it breaks (the table's ruling).
function getCutTether(state: CombatState, root: CutAction): Tether | undefined {
  return root.targetId ? getTethersOf(state, root.targetId)[0] : undefined
}

export function getNetTethers(state: CombatState, root: CutAction): Tether[] {
  const tether = getCutTether(state, root)
  if (!tether) return []
  const holderId = tether.holders[0]
  return getTethers(state).filter((t) => t.holders[0] === holderId && t.anchors[holderId] === tether.anchors[holderId])
}

// What the net is made of: the exploding row of the item the holder holds it by.
function getNetBreakable(state: CombatState, tether: Tether): { RES: number; hardness: number } | null {
  const holder: CampaignCharacter | undefined = state.characters[tether.holders[0]]
  const item = holder ? getHeldItem(holder, tether.anchors[holder.id]) : undefined
  const row = item ? getItemWeapon(item)?.attacks.find(explodes) : undefined
  return row ? { RES: row.RES, hardness: getHardness(row.material) } : null
}

// The chance the blow breaks the net, from the row it was swung with.
export function getCutBreakChance(state: CombatState, root: CutAction): number {
  const cutter = state.characters[root.actorId]
  const row = cutter ? findWeaponRow(cutter, root.weaponKey, root.attack) : null
  const net = getCutTether(state, root)
  const breakable = net ? getNetBreakable(state, net) : null
  if (!cutter || !row || !breakable) return 0
  return getBreakChance({ ...getStrikeDamage(row.atk, row.weapon, cutter), hardness: getHardness(row.atk.material) }, breakable)
}

// Whether the cut landed and the net gave way.
export function isNetCut(state: CombatState, root: CutAction): boolean {
  return isWon(root) && root.breakRoll < getCutBreakChance(state, root) * 100
}
