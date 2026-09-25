import type { CampaignCharacter } from '../../types'
import type { Updater, Grapple } from '../types'
import { diffGrappleAfflictions, getHeldGrapples } from '../rules/grapple'
import { cure, inflict } from '../../character/commands/addAffliction'

// Brings the fight's grapples and the characters in them back into line
// with each other after anything that may have changed either: a holder
// left with no grapple row lets go ("the grapplers must have a grapple
// property attack in one of their weapons at all times"), and every
// character whose grapples changed since `before` has the grappled and
// immobile afflictions, and the seizure of what a disarm took hold of
// (combat.tex "Disarm"), put on or taken off to match.
export function settleGrapples(before: Grapple[]): Updater {
  return (state) => {
    const after = getHeldGrapples(state, state.grapples)
    if (sameGrapples(after, state.grapples) && sameGrapples(state.grapples, before)) return state
    const ids = [...new Set([...before, ...after].flatMap((g) => g.members))]
    const { on, off } = diffGrappleAfflictions(state, before, after, ids)
    const seizedBefore = new Set(before.flatMap((g) => g.seized))
    const seizedAfter = new Set(after.flatMap((g) => g.seized))
    const characters = Object.fromEntries(Object.entries(state.characters).map(([id, c]): [string, CampaignCharacter] => {
      const add = on[id] ?? []
      const remove = off[id] ?? []
      const touchesSeized = c.held.some((i) => seizedBefore.has(i.id) || seizedAfter.has(i.id))
      if (add.length === 0 && remove.length === 0 && !touchesSeized) return [id, c]
      const afflicted = inflict(add)(cure(remove)(c))
      const held = touchesSeized ? c.held.map((i) => (seizedBefore.has(i.id) || seizedAfter.has(i.id) ? { ...i, seized: seizedAfter.has(i.id) } : i)) : c.held
      return [id, { ...afflicted, held }]
    }))
    return { ...state, grapples: after, characters }
  }
}

function sameGrapples(a: Grapple[], b: Grapple[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
