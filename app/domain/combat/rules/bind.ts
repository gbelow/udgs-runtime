import type { Bind, CombatState, Coord } from '../types'
import { getHeldItem } from '../../item/rules/hands'
import { isGrapplingStill } from './grapple'
import { setDistance } from '../geometry'
import { getDistanceBetween, getPlacedFootprint } from './board'
import { getPartner, getTethers, isTether } from './partners'

// Whether the holder still maintains the bind with what it was made with.
function isMaintained(state: CombatState, id: string, b: Bind): boolean {
  switch (b.kind) {
    case 'grapple':
      return isGrapplingStill(state, id, b)
    case 'tether':
      return !!state.characters[id] && !!getHeldItem(state.characters[id], b.anchors[id])
  }
}

// gear.tex "Net": the tethered cannot leave the tether's length of whoever
// tied them, nor they of the tethered. Whether the character, standing on
// `footprint`, is still within every tether of theirs — or is closing one
// already stretched.
export function isTetherKept(state: CombatState, id: string, footprint: readonly Coord[]): boolean {
  if (!state.binds.some(isTether)) return true
  return getTethers(state)
    .filter((t) => t.members.includes(id))
    .every((t) => {
      const partnerId = getPartner(t, id)
      const there = getPlacedFootprint(state, partnerId)
      const next = there ? setDistance(footprint, there) : null
      const now = getDistanceBetween(state, id, partnerId)
      return next === null || next <= t.length || (now !== null && next < now)
    })
}

// The binds once every holder `letsGo` says lets go has, and any bind nobody
// holds any more is over; the same list when nobody lets go.
export function dropHolders<B extends Bind>(binds: B[], letsGo: (id: string, b: B) => boolean): B[] {
  if (!binds.some((b) => b.holders.some((id) => letsGo(id, b)))) return binds
  return binds
    .map((b) => {
      const holders = b.holders.filter((id) => !letsGo(id, b))
      return { ...b, holders, anchors: Object.fromEntries(Object.entries(b.anchors).filter(([id]) => holders.includes(id))) }
    })
    .filter((b) => b.holders.length > 0)
}

// The binds as they stand once every holder who no longer maintains theirs
// has let go.
export function getHeldBinds(state: CombatState): Bind[] {
  return dropHolders(state.binds, (id, b) => !isMaintained(state, id, b))
}
