import type { ActionKind, SceneState, Placement, RootAction } from '../scene/types'
import { declareReaction } from '../scene/commands/action'
import { findOption, getAvailableActions } from '../scene/rules/options'
import { getEvasiveJumpPlacements } from '../scene/rules/move'
import { getLiveReactionsTo, getOpenAction } from '../scene/rules/log'
import { getOptionLabel } from '../scene/projections/labels'
import { declareDefense } from './answer'

// Every answer the target of a committed strike or shot may make to it, read
// off the options the panel offers (combat.tex "Defend", "Reflex"): the ones
// the option alone declares, and an evasive jump to each landing it may make.
// A bot's own reflexes (`answer.ts`) are fewer than what a player may do, so
// whatever weighs an attack, or offers a defense to someone who plays it, reads
// this instead.

export type StrikeDefense = {
  label: string
  kind: ActionKind
  cost: { AP: number; STA: number }
  // where an evasive jump lands
  landing: Placement | null
  declare: (state: SceneState, open: RootAction, newId: () => string) => SceneState | null
}

const BY_OPTION: readonly ActionKind[] = ['block', 'evade', 'intercept', 'guard', 'evasion']

export function getStrikeDefenses(state: SceneState, targetId: string, attackerId: string): StrikeDefense[] {
  if (getOpenAction(state)?.step !== 'react') return []
  const answers: StrikeDefense[] = getAvailableActions(state, targetId)
    .filter((o) => o.available && BY_OPTION.includes(o.draft.kind))
    .map((option) => ({
      label: getOptionLabel(state, targetId, option),
      kind: option.draft.kind,
      cost: { AP: option.cost?.AP ?? 0, STA: option.cost?.STA ?? 0 },
      landing: null,
      declare: (s, open, newId) => declareDefense(s, targetId, open, option, newId),
    }))

  const jump = findOption(state, targetId, { kind: 'evasiveJump' })
  if (!jump?.available) return answers
  return [
    ...answers,
    ...getEvasiveJumpPlacements(state, targetId, attackerId).map((to): StrikeDefense => ({
      label: `evasive jump to (${to.cell.q},${to.cell.r})`,
      kind: 'evasiveJump',
      cost: { AP: jump.cost?.AP ?? 0, STA: jump.cost?.STA ?? 0 },
      landing: to,
      declare: (s, open, newId) => {
        const declared = declareReaction(targetId, { kind: 'evasiveJump', to }, newId)(s)
        return getLiveReactionsTo(declared, open.id).some((r) => r.actorId === targetId) ? declared : null
      },
    })),
  ]
}
