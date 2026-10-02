import type { Item } from '../../types'
import { getItemWeapon } from '../../item/rules/items'
import { explodes } from '../../weaponProperties'
import type { BlastAction, CombatState, Tether } from '../types'
import { getAction } from './log'

// gear.tex "Net": an object whose exploding rows carry a tether stays in the
// thrower's hand, tied to what it caught by its rope — it is not thrown away.
export function isTying(item: Item): boolean {
  return getItemWeapon(item)?.attacks.some((a) => explodes(a) && a.payload.some((e) => e.type === 'tether')) ?? false
}

// What a blast tied to whoever it caught: a tether from its thrower to each
// other character whose zone has a DL to slip it, to the net the explosion
// went off with, replacing any they already have.
export function getTethersMade(state: CombatState, blast: BlastAction): Tether[] {
  const opener = blast.spawnedBy ? getAction(state, blast.spawnedBy) : null
  const itemId = opener?.kind === 'explosion' ? opener.itemId : ''
  return Object.entries(blast.facts ?? {}).flatMap(([id, deliveries]) => {
    if (id === blast.actorId) return []
    return deliveries.flatMap((d): Tether[] => {
      if (d.effect.type !== 'tether') return []
      const dl = d.degree === null || d.degree === 'miss' ? null : d.effect.effect.dl[d.degree]
      return dl === null ? [] : [{ kind: 'tether', members: [blast.actorId, id], holders: [blast.actorId], anchors: { [blast.actorId]: itemId }, length: d.effect.effect.length, dl }]
    })
  })
}
