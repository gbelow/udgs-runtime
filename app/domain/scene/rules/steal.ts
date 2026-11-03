import type { Item } from '../../types'
import type { SceneState, StealAction } from '../types'
import type { Term } from '../../character/rules/terms'
import { getPrestidigitationTerms } from '../../character/rules/skills'
import { getSize } from '../../character/rules/size'
import { isDead } from '../../character/rules/afflictions'
import { GEAR_SIZE } from '../../item/rules/items'
import { getPlacedFootprint } from './board/board'
import { canPickUp, isInReach } from './floor'
import { getSenseReaches, getSensoryTermsHere } from './detection'
import { getCarriedBy, isSameSource, type LootItem } from './loot'
import { notices } from './stealth'

// combat.tex "Theft": "A standard action can be used to steal an item from
// someone's body ... having one hand free". What they have on them, within
// reach: in their hands and on their back, and in the containers they wear,
// none of it needing to be opened.

// Whether the character stands within reach of the other, which a thief must.
function isWithinReach(state: SceneState, id: string, victimId: string): boolean {
  const footprint = getPlacedFootprint(state, victimId)
  return !state.board || !footprint || footprint.some((cell) => isInReach(state, id, cell))
}

// Everything the thief could lift off the victim.
export function getStealable(state: SceneState, thiefId: string, victimId: string): LootItem[] {
  const victim = state.characters[victimId]
  if (!victim || victimId === thiefId || isDead(victim) || !isWithinReach(state, thiefId, victimId)) return []
  return getCarriedBy(victim, state.board?.placements[victimId]?.cell ?? null)
}

// Those within reach with something a free hand could take.
export function getStealTargets(state: SceneState, thiefId: string): string[] {
  const thief = state.characters[thiefId]
  return Object.keys(state.characters).filter((id) => !!thief && getStealable(state, thiefId, id).some((l) => canPickUp(thief, l.item)))
}

export function findStealable(state: SceneState, root: StealAction): LootItem | null {
  return !root.targetId ? null : getStealable(state, root.actorId, root.targetId).find((l) => l.item.id === root.itemId && isSameSource(l.from, root.from)) ?? null
}

// combat.tex "Theft": "Detection +5x for every item bulk category over small
// (relative to who must detect it)": a bulk is read against the size of the
// one who must notice it, so a giant sees a large item as small.
export function getSizeCategoriesOver(item: Item, victimId: string, state: SceneState): number {
  const victim = state.characters[victimId]
  return Math.max(0, item.bulk - (victim ? getSize(victim) - GEAR_SIZE : 0) - 1)
}

// The thief's test and what it is against: the best of the victim's reactive
// senses that take the thief in ("Detection uses the best sense available",
// combat.tex "Stealth"), five more for every category of bulk over small, and
// five less when the thief is not noticed.
export function getStealTerms(state: SceneState, root: StealAction): { skill: Term[]; DL: Term[] } | null {
  const actor = state.characters[root.actorId]
  const found = findStealable(state, root)
  if (!actor || !root.targetId || !found) return null
  const best = getSenseReaches(state, root.targetId, root.actorId).filter((r) => r.reactive).reduce<{ detection: number; terms: Term[] } | null>((top, r) => (top && top.detection >= r.detection ? top : r), null)
  const over = getSizeCategoriesOver(found.item, root.targetId, state)
  const hidden = !notices(state, root.targetId, root.actorId)
  return {
    skill: [...getPrestidigitationTerms(actor), ...getSensoryTermsHere(state, actor.id, 'prestidigitation'), ...(hidden ? [{ label: 'from stealth', value: 5 }] : [])],
    DL: [...(best?.terms ?? []), ...(over > 0 ? [{ label: 'item size', value: 5 * over }] : [])],
  }
}

// combat.tex "Theft": "On criticals, it is stolen without being noticed. On
// successes, the character can choose between successfully stealing or
// failing without drawing attention. On grazes and failures, attention is
// drawn and it fails."
export function getStealOutcome(root: StealAction): { stolen: boolean; noticed: boolean } {
  switch (root.roll?.degree) {
    case 'critical': return { stolen: true, noticed: false }
    case 'hit': return { stolen: root.take, noticed: root.take }
    default: return { stolen: false, noticed: true }
  }
}

// Whether the thief is asked whether to take it: only a hit leaves the choice.
export function isTheftChoiceOffered(root: StealAction): boolean {
  return root.step === 'post' && root.roll?.degree === 'hit'
}
