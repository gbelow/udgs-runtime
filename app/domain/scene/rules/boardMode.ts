import type { SceneState } from '../types'
import { getOpenAction, findOpenRoot } from './log'
import { findOption } from './options'
import { getAim } from './aim'
import { isAimable } from './explosion'
import { getEvasiveJumpPlacements } from './move'
import { canPickUp, getReachableFloor } from './floor'

// What a click on the board means depends on what the open action is waiting
// for: a path, the landing of an evasive jump, the aim of an explosion, or
// nothing the board can answer.
export type BoardMode = 'idle' | 'path' | 'jump' | 'aim' | 'locked'

// The target of a committed strike whose evasive jump is still theirs to
// declare (combat.tex "Evasive Jump").
export function getEvasiveJumper(state: SceneState): string | null {
  const open = getOpenAction(state)
  return open?.kind === 'strike' && open.step === 'react' && open.targetId && findOption(state, open.targetId, { kind: 'evasiveJump' })?.available ? open.targetId : null
}

export function getBoardMode(state: SceneState): BoardMode {
  const open = getOpenAction(state)
  if ((open?.kind === 'move' || open?.kind === 'drag') && open.step === 'define') return 'path'
  const jumper = getEvasiveJumper(state)
  if (open && jumper && getEvasiveJumpPlacements(state, jumper, open.actorId).length > 0) return 'jump'
  const blast = findOpenRoot(state, 'blast')
  if ((blast !== null && isAimable(state, blast)) || getAim(state, open) !== null) return 'aim'
  return open ? 'locked' : 'idle'
}

// Who would pick an item up off the floor by a click, and which items they
// could take: the one whose pick up is being declared, else the active
// character if they may pick up at all. Null when nothing is within reach.
export function getFloorPicker(state: SceneState): { picker: string, itemIds: string[] } | null {
  const open = getOpenAction(state)
  const picker = open?.kind === 'pickUp' && open.step === 'define' ? open.actorId
    : !open && state.activeCharacterId && findOption(state, state.activeCharacterId, { kind: 'pickUp' })?.available ? state.activeCharacterId
    : null
  const character = picker ? state.characters[picker] : undefined
  if (!picker || !character) return null
  const itemIds = getReachableFloor(state, picker).filter((f) => canPickUp(character, f.item)).map((f) => f.item.id)
  return itemIds.length > 0 ? { picker, itemIds } : null
}
