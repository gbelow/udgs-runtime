import type { SceneState } from '../types'
import { perState } from '../../perState'
import { getFollowSceneBar, isFollowOpen } from '../rules/parked'
import { getPartyName } from '../rules/fighters'

// Whom the scene follows and whom it may follow instead, once a chase is
// over; null while there is nothing to pick.
export type FollowPanel = {
  following: string | null
  options: { id: string; name: string; bar: string | null }[]
}

function buildFollowPanel(state: SceneState): FollowPanel | null {
  if (!isFollowOpen(state)) return null
  const followed = state.chase ? null : state.followed
  return {
    following: followed && getPartyName(state, followed),
    options: Object.keys(state.parties).filter((p) => p !== followed).map((p) => ({ id: p, name: getPartyName(state, p), bar: getFollowSceneBar(state, p) })),
  }
}

export const getFollowPanel = perState(buildFollowPanel)
export const getFollowDigest = perState((state: SceneState) => JSON.stringify(getFollowPanel(state)))
