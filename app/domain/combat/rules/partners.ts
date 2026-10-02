import type { Arc, Bind, CombatState, Grapple, Link, Tether } from '../types'

// Who is in a grapple with whom.

export function isGrapple(b: Bind): b is Grapple {
  return b.kind === 'grapple'
}

export function getGrapples(state: CombatState): Grapple[] {
  return state.binds.filter(isGrapple)
}

export function isTether(b: Bind): b is Tether {
  return b.kind === 'tether'
}

export function getTethers(state: CombatState): Tether[] {
  return state.binds.filter(isTether)
}

function isArc(b: Bind): b is Arc {
  return b.kind === 'arc'
}

// The one the caster's held spell is bound to, if it makes an arc and it is
// up (spells.tex "Sustained Lightning").
export function getArc(state: CombatState, casterId: string, key: string): Arc | undefined {
  return state.binds.filter(isArc).find((a) => a.holders[0] === casterId && a.key === key)
}

function isLink(b: Bind): b is Link {
  return b.kind === 'link'
}

// The links the caster's held spell makes, one to each target.
export function getLinks(state: CombatState, casterId: string, key: string): Link[] {
  return state.binds.filter((b): b is Link => isLink(b) && b.holders[0] === casterId && b.key === key)
}

export function getTethersOf(state: CombatState, id: string): Tether[] {
  return getTethers(state).filter((t) => t.members.includes(id))
}

export function findGrapple(grapples: Grapple[], a: string, b: string): Grapple | null {
  return grapples.find((g) => a !== b && g.members.includes(a) && g.members.includes(b)) ?? null
}

export function getGrapplesOf(state: CombatState, id: string): Grapple[] {
  return getGrapples(state).filter((g) => g.members.includes(id))
}

export function isInGrapple(state: CombatState, id: string): boolean {
  return getGrapplesOf(state, id).length > 0
}

export function getPartner(g: Pick<Bind, 'members'>, id: string): string {
  return g.members[0] === id ? g.members[1] : g.members[0]
}

export function getPartners(state: CombatState, id: string): string[] {
  return getGrapplesOf(state, id).map((g) => getPartner(g, id))
}

export function holds(g: Bind, holderId: string): boolean {
  return g.holders.includes(holderId)
}

// Whether anyone holds the character.
export function isHeld(grapples: Grapple[], id: string): boolean {
  return grapples.some((g) => g.members.includes(id) && holds(g, getPartner(g, id)))
}

// Everyone locked together with the character through any chain of
// binds, the character included (combat.tex "Push and drag": all of them
// are dragged).
export function getGrappleGroup(grapples: readonly Pick<Bind, 'members'>[], id: string): string[] {
  const group = new Set([id])
  const queue = [id]
  while (queue.length > 0) {
    const next = queue.pop()!
    for (const g of grapples) {
      if (!g.members.includes(next)) continue
      const other = getPartner(g, next)
      if (!group.has(other)) {
        group.add(other)
        queue.push(other)
      }
    }
  }
  return [...group]
}
