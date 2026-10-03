import type { CampaignCharacter } from '../types'
import type { CombatState, Coord } from '../combat/types'
import type { Dice } from '../combat/dice'
import { getAttackKind } from '../weaponProperties'
import { setDistance } from '../combat/geometry'
import { findWeaponRow } from '../combat/rules/weaponRow'
import { getTargetIds } from '../combat/rules/action'
import { getAmmoOptions, getFreeAttackOptions, hasUnfocusedRow, type AttackOption } from '../combat/rules/attack'
import { getAction, getOpenAction } from '../combat/rules/log'
import { getReachableCells, type ReachableCell } from '../combat/rules/move'
import { amendAction, commitAction, declareAction, setTarget } from '../combat/commands/action'
import { surge } from '../combat/commands/turn'
import { canAfford } from '../character/rules/cost'
import { getInjuryPenalty } from '../character/rules/afflictions'
import { getLiveFoes, type Party } from './party'

// What a bot does with its own turn: strike a foe within reach, else shoot
// one, else close in on the nearest. Every attempt is made on a copy of the
// state, so one that does not come off costs nothing; null is no way to act.

export function act(state: CombatState, party: Party, id: string, dice: Dice, newId: () => string): CombatState | null {
  return attack('strike', state, party, id, dice, newId) ?? attack('shoot', state, party, id, dice, newId) ?? approach(state, party, id, dice, newId)
}

// Whether the declared action got past its commit: one refused stays at
// `define`.
function isCommitted(state: CombatState, id: string): boolean {
  const action = getAction(state, id)
  return action !== null && action.step !== 'define'
}

// The least penalised variation first.
function byPenalty(a: AttackOption, b: AttackOption): number {
  return a.penalty - b.penalty
}

// The most wounded first.
function byWounds(state: CombatState): (a: string, b: string) => number {
  return (a, b) => getInjuryPenalty(state.characters[b]) - getInjuryPenalty(state.characters[a])
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

function attack(kind: 'strike' | 'shoot', state: CombatState, party: Party, id: string, dice: Dice, newId: () => string): CombatState | null {
  const ready = withFocus(kind, state, id)
  const c = ready.characters[id]
  const declared = declareAction(id, { kind }, newId)(ready)
  const open = getOpenAction(declared)
  if (open?.kind !== kind) return null
  const foes = getLiveFoes(ready, party)
  const options = getFreeAttackOptions(ready, c, kind).filter((o) => canAfford(c, o) && !isThrownRow(c, o)).sort(byPenalty)
  for (const { weaponKey, attack: row, variant } of options) {
    const armed = withAmmo(amendAction({ weaponKey, attack: row, variant })(declared), id)
    const aimable = getOpenAction(armed)
    if (!aimable) continue
    const targets = getTargetIds(armed, aimable).filter((t) => foes.includes(t)).sort(byWounds(armed))
    for (const target of targets) {
      const committed = commitAction(dice, newId)(setTarget(target)(armed))
      if (isCommitted(committed, open.id)) return committed
    }
  }
  return null
}

type Walk = { movement: 'basic' | 'run'; to: ReachableCell; gap: number }

// A walk to whichever reachable cell is nearest a foe, by the kind of
// movement that gets closest (the cheaper on a tie), if any is nearer than
// where the character stands.
function approach(state: CombatState, party: Party, id: string, dice: Dice, newId: () => string): CombatState | null {
  const origin = state.board?.placements[id]?.cell
  const foes: Coord[] = getLiveFoes(state, party).flatMap((f) => state.board?.placements[f]?.cell ?? [])
  if (!origin || foes.length === 0) return null
  const declared = declareAction(id, { kind: 'move' }, newId)(state)
  const open = getOpenAction(declared)
  if (open?.kind !== 'move') return null

  const here = setDistance([origin], foes)
  const walks = (['basic', 'run'] as const).flatMap((movement): Walk[] => {
    const moving = amendAction({ movement })(declared)
    const aimed = getOpenAction(moving)
    return aimed?.kind === 'move' ? getReachableCells(moving, aimed).map((to) => ({ movement, to, gap: setDistance([to.cell], foes) })) : []
  })
  const best = walks
    .filter((w) => w.gap < here)
    .reduce<Walk | null>((a, b) => (!a || b.gap < a.gap || (b.gap === a.gap && b.to.steps < a.to.steps) ? b : a), null)
  if (!best) return null
  const committed = commitAction(dice, newId)(amendAction({ movement: best.movement, path: best.to.path })(declared))
  return isCommitted(committed, open.id) ? committed : null
}
