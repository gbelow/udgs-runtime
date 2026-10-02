import type { Character, Item } from '../../types'
import { type ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { getPrestidigitationTerms } from '../../character/rules/skills'
import type { Term } from '../../character/rules/terms'
import { getItemWeapon } from '../../item/rules/items'
import { explodes } from '../../weaponProperties'
import type { BlastAction, CombatState, SlipAction, Tether } from '../types'
import { getAction } from './log'
import { getPartner, getTethers, getTethersOf } from './partners'

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

// gear.tex "Net": a tethered character slips it with a Prestidigitation test
// against the DL of the zone they were caught in, costing two standard
// actions (the table's ruling) and freeing them on a hit or a critical.
export function getSlipCost(c: Character): ActionCost {
  const { AP, STA } = getActionCost(c, 'standardAction')
  return { AP: 2 * AP, STA: 2 * STA }
}

// Everyone on the other end of a tether of the character's, whoever holds it:
// either end may pull the other (gear.tex "Net").
export function getPullTargets(state: CombatState, id: string): string[] {
  return getTethersOf(state, id).map((t) => getPartner(t, id))
}

// The ones whose tethers the character is caught in.
export function getSlipTargets(state: CombatState, id: string): string[] {
  return getTethersOf(state, id).filter((t) => !t.holders.includes(id)).map((t) => getPartner(t, id))
}

// The tether the slip is made against: the one between the actor and its target.
export function findSlipTether(state: CombatState, root: SlipAction): Tether | undefined {
  return getTethers(state).find((t) => t.members.includes(root.actorId) && !!root.targetId && t.members.includes(root.targetId))
}

export function getSlipTerms(state: CombatState, root: SlipAction): { skill: Term[]; DL: Term[] } | null {
  const actor = state.characters[root.actorId]
  const tether = findSlipTether(state, root)
  return actor && tether ? { skill: getPrestidigitationTerms(actor), DL: [{ label: 'net', value: tether.dl }] } : null
}
