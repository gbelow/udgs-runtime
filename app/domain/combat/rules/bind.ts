import type { Bind, CombatState, Coord } from '../types'
import { getHeldItem } from '../../item/rules/hands'
import { getHeldEntry } from '../../character/rules/concentration'
import { SPELLS, isSpellKey } from '../../spells'
import { isGrapplingStill } from './grapple'
import { setDistance } from '../geometry'
import { getDistanceBetween, getPlacedFootprint } from './board'
import { getPartner, getTethersOf, isTether } from './partners'

// Whether the holder still maintains the bind with what it was made with.
function isMaintained(state: CombatState, id: string, b: Bind): boolean {
  switch (b.kind) {
    case 'grapple':
      return isGrapplingStill(state, id, b)
    case 'tether':
      return !!state.characters[id] && !!getHeldItem(state.characters[id], b.anchors[id])
    case 'arc':
    case 'link':
      return !!state.characters[id] && isSpellKey(b.key) && !!getHeldEntry(state.characters[id], b.key)
  }
}

// gear.tex "Net": the tethered cannot leave the tether's length of whoever
// tied them, nor they of the tethered. Whether the character, standing on
// `footprint`, is still within every tether of theirs — or is closing one
// already stretched.
export function isTetherKept(state: CombatState, id: string, footprint: readonly Coord[]): boolean {
  if (!state.binds.some(isTether)) return true
  return getTethersOf(state, id)
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

// spells.tex "Telepathic Link": "until the maximum distance is exceeded" —
// a link whose target stands farther than the spell's range from the caster,
// as far as it was extended. A fight without a board has no distance.
function isStretched(state: CombatState, b: Bind): boolean {
  if (b.kind !== 'link' || !isSpellKey(b.key)) return false
  const range = SPELLS[b.key].linkRange
  const caster = state.characters[b.holders[0]]
  const distance = getDistanceBetween(state, b.holders[0], getPartner(b, b.holders[0]))
  if (range === undefined || !caster || distance === null) return false
  return distance > range * (1 + (getHeldEntry(caster, b.key)?.extend ?? 0))
}

// The binds as they stand once every holder who no longer maintains theirs
// has let go, and every link stretched past its range is broken.
export function getHeldBinds(state: CombatState): Bind[] {
  const held = dropHolders(state.binds, (id, b) => !isMaintained(state, id, b))
  return held.some((b) => isStretched(state, b)) ? held.filter((b) => !isStretched(state, b)) : held
}
