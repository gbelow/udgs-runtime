import { getDiceBar } from '../../../play/calls'
import type { SceneState } from '../../types'
import { getOpenAction, findOpenRoot } from '../log'
import { findOpenJump, findOption } from '../options'
import { getAim } from '../aim'
import { isAimable } from '../explosion'
import { getEvasiveJumpPlacements } from '../move'
import { canPickUp, getReachableFloor } from '../floor'
import { isSteadyShot } from '../steadyArms'

// What a click on the board means depends on what the open action is waiting
// for: a path, the landing of an evasive jump, the aim of an explosion, or
// nothing the board can answer.
export type BoardMode = 'idle' | 'path' | 'jump' | 'aim' | 'locked'

// The target of a committed strike whose evasive jump is still theirs to
// declare (combat.tex "Evasive Jump").
export function getEvasiveJumper(state: SceneState): string | null {
  const open = getOpenAction(state)
  return open?.kind === 'strike' && open.step === 'react' && open.targetId && findOpenJump(state, open.targetId) ? open.targetId : null
}

export function getBoardMode(state: SceneState): BoardMode {
  if (getDiceBar(state.calls)) return 'locked'
  const open = getOpenAction(state)
  if ((open?.kind === 'move' || open?.kind === 'drag') && open.step === 'define') return 'path'
  // abilities.tex "Steady Arms": the careful path is drawn with the shot
  if (open?.kind === 'shoot' && open.step === 'define' && isSteadyShot(open)) return 'path'
  const jumper = getEvasiveJumper(state)
  if (open && jumper && getEvasiveJumpPlacements(state, jumper, open.actorId).length > 0) return 'jump'
  const blast = findOpenRoot(state, 'blast')
  if ((blast !== null && isAimable(state, blast)) || getAim(state, open) !== null) return 'aim'
  return open ? 'locked' : 'idle'
}

// Who would pick an item up off the floor by a click, and which items they
// could take: the one whose pick up is being declared, else the character
// `selected` if they may pick up at all. Null when nothing is within reach.
export function getFloorPicker(state: SceneState, selected: string | null): { picker: string, itemIds: string[] } | null {
  if (getDiceBar(state.calls)) return null
  const open = getOpenAction(state)
  const picker = open?.kind === 'pickUp' && open.step === 'define' ? open.actorId
    : !open && selected && findOption(state, selected, { kind: 'pickUp' })?.available ? selected
    : null
  const character = picker ? state.characters[picker] : undefined
  if (!picker || !character) return null
  const itemIds = getReachableFloor(state, picker).filter((f) => canPickUp(character, f.item)).map((f) => f.item.id)
  return itemIds.length > 0 ? { picker, itemIds } : null
}
