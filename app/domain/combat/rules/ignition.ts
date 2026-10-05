import type { AttackAction, CombatState } from '../types'
import { getChargedWeapon } from './damage'

// combat.tex "Burning and radiant damage", "Fire": the burning damage an
// attack carries, which sets alight the fuel where it lands. It rides on the
// blow in the charge of the item it is made with (spells.tex "Charged").
export function getBurnOf(state: CombatState, attack: AttackAction): number {
  const attacker = state.characters[attack.actorId]
  const charged = attacker ? getChargedWeapon(attacker, attack) : null
  return (charged?.charge?.effects ?? [])
    .filter((e) => e.area === null)
    .flatMap((e) => (e.type === 'damage' ? e.effect.damage : []))
    .reduce((total, d) => total + (d.kind === 'burn' ? d.value : 0), 0)
}
