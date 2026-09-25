import type { CombatState, Grapple } from '../types'

// Who is in a grapple with whom.

export function findGrapple(grapples: Grapple[], a: string, b: string): Grapple | null {
  return grapples.find((g) => a !== b && g.members.includes(a) && g.members.includes(b)) ?? null
}

export function getGrapplesOf(state: CombatState, id: string): Grapple[] {
  return state.grapples.filter((g) => g.members.includes(id))
}

export function isInGrapple(state: CombatState, id: string): boolean {
  return getGrapplesOf(state, id).length > 0
}

export function getPartner(g: Grapple, id: string): string {
  return g.members[0] === id ? g.members[1] : g.members[0]
}

export function getPartners(state: CombatState, id: string): string[] {
  return getGrapplesOf(state, id).map((g) => getPartner(g, id))
}

export function holds(g: Grapple, holderId: string): boolean {
  return g.holders.includes(holderId)
}

// Whether anyone holds the character.
export function isHeld(grapples: Grapple[], id: string): boolean {
  return grapples.some((g) => g.members.includes(id) && holds(g, getPartner(g, id)))
}

// Everyone locked together with the character through any chain of
// grapples, the character included (combat.tex "Push and drag": all of them
// are dragged).
export function getGrappleGroup(grapples: Grapple[], id: string): string[] {
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
