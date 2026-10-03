import type { CampaignCharacter } from '../types'
import type { AttackAction, CombatState } from '../combat/types'
import { getAttackKind } from '../weaponProperties'
import { findWeaponRow } from '../combat/rules/weaponRow'
import { getTargetIds } from '../combat/rules/action'
import { getAmmoOptions, getDefaultAim, getFreeAttackOptions, hasUnfocusedRow, type AttackOption } from '../combat/rules/attack'
import { getOpenAction } from '../combat/rules/log'
import { makeAction } from '../combat/factories'
import { appendActions } from '../combat/commands/log'
import { amendAction, declareAction } from '../combat/commands/action'
import { surge } from '../combat/commands/turn'
import { canAfford } from '../character/rules/cost'

// The attacks a character could make from where it stands: a strike or a shot
// declared with each row and variation it can pay for, not yet aimed. Used for
// the bot's own turn and to ask what a foe could do to it.

export type Armed = {
  kind: 'strike' | 'shoot'
  // the attack declared and open, `option` filled in
  state: CombatState
  openId: string
  option: AttackOption
  // everyone it could be aimed at from here
  targets: string[]
}

// The least penalised variation first, the harder hitting of those.
function byOffense(a: AttackOption, b: AttackOption): number {
  return a.penalty - b.penalty || b.blunt + b.cut - (a.blunt + a.cut)
}

// combat.tex "Focus surge": "required to use ranged attacks".
function withFocus(kind: 'strike' | 'shoot', state: CombatState, id: string): CombatState {
  const c = state.characters[id]
  const closed = kind === 'shoot' && getFreeAttackOptions(state, c, kind).length === 0 && hasUnfocusedRow(c, kind)
  return closed ? surge(id, 'focus')(state) : state
}

// A thrown weapon leaves the hand (combat.tex "Throw"); a bot keeps its own.
function isThrownRow(c: CampaignCharacter, o: AttackOption): boolean {
  const row = findWeaponRow(c, o.weaponKey, o.attack)
  return row !== null && getAttackKind(row.atk.range) === 'throw'
}

function withAmmo(state: CombatState, id: string): CombatState {
  const open = getOpenAction(state)
  const ammo = open?.kind === 'shoot' ? getAmmoOptions(state.characters[id], open)[0] : undefined
  return ammo ? amendAction({ ammoId: ammo.itemId })(state) : state
}

// The character's attacks of the kind that it could make: after the focus
// surge a shot needs, each row and variation it can pay for.
function getRows(state: CombatState, id: string, kind: 'strike' | 'shoot'): { ready: CombatState; options: AttackOption[] } {
  const ready = withFocus(kind, state, id)
  const c = ready.characters[id]
  const options = getFreeAttackOptions(ready, c, kind).filter((o) => canAfford(c, o) && !isThrownRow(c, o)).sort(byOffense)
  return { ready, options }
}

export function getArmedAttacks(state: CombatState, id: string, kind: 'strike' | 'shoot', newId: () => string): Armed[] {
  const { ready, options } = getRows(state, id, kind)
  const declared = declareAction(id, { kind }, newId)(ready)
  const open = getOpenAction(declared)
  if (open?.kind !== kind) return []
  return options.flatMap((option) => {
    const armed = withAmmo(amendAction({ weaponKey: option.weaponKey, attack: option.attack, variant: option.variant })(declared), id)
    const aimable = getOpenAction(armed)
    return aimable ? [{ kind, state: armed, openId: open.id, option, targets: getTargetIds(armed, aimable) }] : []
  })
}

// What a character could do to someone from where it stands, built without
// going through the declaring commands, for asking about attacks no one has
// declared: each as a committed attack waiting on its die, once aimed.
export type Strike = {
  state: CombatState
  open: AttackAction
  targets: string[]
}

export function getStrikes(state: CombatState, id: string, kind: 'strike' | 'shoot', newId: () => string): Strike[] {
  const { ready, options } = getRows(state, id, kind)
  const c = ready.characters[id]
  const actionId = newId()
  return options.map((option) => {
    const base = makeAction(kind, { id: actionId, actorId: id, weaponKey: option.weaponKey, attack: option.attack, variant: option.variant, step: 'react' })
    const open = base.kind === 'shoot' ? { ...base, ammoId: getAmmoOptions(c, base)[0]?.itemId ?? '' } : base
    return { state: ready, open, targets: getTargetIds(ready, open) }
  })
}

// The strike aimed at the target and open in the state, waiting on its die.
export function aimStrike(strike: Strike, targetId: string): CombatState {
  return appendActions(strike.state, [{ ...strike.open, targetId, ...getDefaultAim(strike.state.characters[targetId]) }])
}
