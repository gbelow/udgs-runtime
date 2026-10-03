import type { CombatState, Coord } from '../combat/types'
import type { Dice } from '../combat/dice'
import { setDistance } from '../combat/geometry'
import { getAction, getOpenAction } from '../combat/rules/log'
import { getReachableCells, type ReachableCell } from '../combat/rules/move'
import { amendAction, commitAction, declareAction, setTarget } from '../combat/commands/action'
import { getInjuryPenalty } from '../character/rules/afflictions'
import { getLiveFoes, type Party } from './party'
import { getArmedAttacks } from './weapons'

// What a bot may do with its turn, each as a way to play it with a die:
// strike or shoot a foe within reach with a row and variation, or walk
// towards the foes. Null from `play` is an option that did not come off.

export type Candidate = {
  label: string
  play: (dice: Dice) => CombatState | null
}

// Whether the declared action got past its commit: one refused stays at
// `define`.
function isCommitted(state: CombatState, id: string): boolean {
  const action = getAction(state, id)
  return action !== null && action.step !== 'define'
}

// The most wounded first.
function byWounds(state: CombatState): (a: string, b: string) => number {
  return (a, b) => getInjuryPenalty(state.characters[b]) - getInjuryPenalty(state.characters[a])
}

// The variations of a row that are tried against one target, the most
// promising first (rules/attack.ts ranks them); the rest are left out to keep
// the options looked at few.
const VARIANTS_TRIED = 3

function attacks(state: CombatState, party: Party, id: string, newId: () => string): Candidate[] {
  const foes = getLiveFoes(state, party)
  const tried = new Map<string, number>()
  return (['strike', 'shoot'] as const).flatMap((kind) => getArmedAttacks(state, id, kind, newId).flatMap((armed) =>
    armed.targets.filter((t) => foes.includes(t)).sort(byWounds(armed.state)).flatMap((target): Candidate[] => {
      const key = `${armed.kind} ${armed.option.weapon} ${armed.option.attack} ${target}`
      const count = tried.get(key) ?? 0
      tried.set(key, count + 1)
      return count >= VARIANTS_TRIED ? [] : [{
        label: `${armed.option.weapon} ${armed.option.attack} (${armed.option.variant}) → ${state.characters[target].fightName}`,
        play: (dice) => {
          const committed = commitAction(dice, newId)(setTarget(target)(armed.state))
          return isCommitted(committed, armed.openId) ? committed : null
        },
      }]
    })))
}

// For each kind of movement, the walk to the reachable cell nearest a foe, if
// it is nearer than where the character stands.
function approaches(state: CombatState, party: Party, id: string, newId: () => string): Candidate[] {
  const origin = state.board?.placements[id]?.cell
  const foes: Coord[] = getLiveFoes(state, party).flatMap((f) => state.board?.placements[f]?.cell ?? [])
  if (!origin || foes.length === 0) return []
  const declared = declareAction(id, { kind: 'move' }, newId)(state)
  const open = getOpenAction(declared)
  if (open?.kind !== 'move') return []

  const here = setDistance([origin], foes)
  return (['basic', 'run'] as const).flatMap((movement): Candidate[] => {
    const moving = amendAction({ movement })(declared)
    const aimed = getOpenAction(moving)
    if (aimed?.kind !== 'move') return []
    const best = getReachableCells(moving, aimed)
      .map((to) => ({ to, gap: setDistance([to.cell], foes) }))
      .filter((w) => w.gap < here)
      .reduce<{ to: ReachableCell; gap: number } | null>((a, b) => (!a || b.gap < a.gap || (b.gap === a.gap && b.to.steps < a.to.steps) ? b : a), null)
    if (!best) return []
    return [{
      label: `move (${movement}) ${best.to.steps} cells, ${best.gap} from the nearest foe`,
      play: (dice) => {
        const committed = commitAction(dice, newId)(amendAction({ movement, path: best.to.path })(declared))
        return isCommitted(committed, open.id) ? committed : null
      },
    }]
  })
}

export function getCandidates(state: CombatState, party: Party, id: string, newId: () => string): Candidate[] {
  return [...attacks(state, party, id, newId), ...approaches(state, party, id, newId)]
}
