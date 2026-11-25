import type { SceneState } from '../types'
import { canSee, getSightOf } from '../rules/seen'
import { isDead } from '../../character/rules/afflictions'

// What a played command has the fight remember: whose faces each character
// detects that they did not know, and, of every action it brought past its
// declaration, who took in its actor before it or after it. Written as a
// command is played and never as one is tried.
export function noteDetected(before: SceneState, after: SceneState): SceneState {
  if (before === after) return after
  const faces = detectFaces(after)
  const witnessed = witnessActions(before, after)
  return faces === after.faces && witnessed === after.witnessed ? after : { ...after, faces, witnessed }
}

// On a board, only who stands on it detects or is detected.
const stands = (state: SceneState, id: string) => !state.board || state.board.placements[id] !== undefined

function detectFaces(state: SceneState): SceneState['faces'] {
  const ids = Object.keys(state.characters).filter((id) => stands(state, id))
  const found = ids.flatMap((observer): [string, string[]][] => {
    if (isDead(state.characters[observer])) return []
    const known = new Set(state.faces[observer] ?? [])
    const unknown = ids.filter((id) => id !== observer && !known.has(id) && (state.partyOf[id] === undefined || state.partyOf[id] !== state.partyOf[observer]))
    if (unknown.length === 0) return []
    const sight = getSightOf(state, observer)
    const met = unknown.filter((id) => sight.has(id))
    return met.length > 0 ? [[observer, [...known, ...met]]] : []
  })
  return found.length > 0 ? { ...state.faces, ...Object.fromEntries(found) } : state.faces
}

function witnessActions(before: SceneState, after: SceneState): SceneState['witnessed'] {
  const played = Object.values(after.actions).filter((a) => a.step !== 'define' && after.witnessed[a.id] === undefined)
  if (played.length === 0) return after.witnessed
  const saw = (state: SceneState, observer: string, actor: string) => state.characters[observer] !== undefined && state.characters[actor] !== undefined && stands(state, observer) && canSee(state, observer, actor)
  return {
    ...after.witnessed,
    ...Object.fromEntries(played.map((a) => [a.id, Object.keys(after.characters).filter((o) => o === a.actorId || saw(after, o, a.actorId) || saw(before, o, a.actorId))])),
  }
}
