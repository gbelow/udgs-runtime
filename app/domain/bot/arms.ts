import type { CampaignCharacter, GearMove } from '../types'
import { SlotKindSchema } from '../types'
import type { ActionCost } from '../character/rules/actionCosts'
import { toCharacterUpdater } from '../character/commands/registry'
import { getGearMoveBlock, getGearMoveCost } from '../item/rules/moves'
import { getFreeHoldingHands, getGrip } from '../item/rules/hands'
import { getOpenContainers } from '../item/rules/containers'
import { getItemWeapon } from '../item/rules/items'

// The ways a character can change what it fights with on its turn, as the
// moves with gear a person would make one after another (item/rules/moves.ts),
// each with the character as it would hold its gear afterwards and what the
// moves cost together. Nothing here decides which, if any, is worth making.
//
// A switch is a held weapon taken in its other grip, a weapon drawn from an
// open container, in one hand or then in two, or the shield on the back taken
// back in hand. A hand is freed for it by letting a stack held in two hands go
// to one before anything is put away (the user's ruling); only when no stack
// is held in two is one put away, each held stack tried in turn: into the slot
// that costs least, or a shield to the back (gear.tex "Shields"). Nothing is
// dropped.

// `paid` counts the moves that have a price, each of which draws opportunity
// attacks (bot/approach.ts)
export type Switch = { moves: GearMove[]; after: CampaignCharacter; cost: ActionCost; paid: number }

const NO_DICE = { dice: () => 0 }

const regrip = (itemId: string, grip: 1 | 2): GearMove => ({ kind: 'regripItem', args: [itemId, grip] })

// The move made after the ones so far, as the fight lands it, priced as the
// fight prices it; null where the gear refuses it.
function then(way: Switch, move: GearMove): Switch | null {
  if (getGearMoveBlock(way.after, move, true) !== null) return null
  const cost = getGearMoveCost(way.after, move)
  if (!cost) return null
  const after = toCharacterUpdater(move, NO_DICE)(way.after, false) as CampaignCharacter
  const paid = way.paid + (cost.AP > 0 || cost.STA > 0 ? 1 : 0)
  return { moves: [...way.moves, move], after, cost: { AP: way.cost.AP + cost.AP, STA: way.cost.STA + cost.STA }, paid }
}

// The held stack put away where that costs least.
function putAway(way: Switch, itemId: string): Switch | null {
  let best: Switch | null = null
  for (const key of Object.keys(getOpenContainers(way.after))) {
    for (const slot of SlotKindSchema.options) {
      const stored = then(way, { kind: 'storeItem', args: [itemId, key, slot] })
      if (stored && (!best || stored.cost.AP < best.cost.AP || (stored.cost.AP === best.cost.AP && stored.cost.STA < best.cost.STA))) best = stored
    }
  }
  return best
}

// The ways to have `hands` hands free, `keep` held as it is.
function freeing(way: Switch, hands: number, keep: string): Switch[] {
  if (getFreeHoldingHands(way.after).length >= hands) return [way]
  const held = way.after.held.filter((item) => item.id !== keep)
  const inTwo = held.find((item) => getGrip(way.after, item.id) >= 2)
  if (inTwo) {
    const loosened = then(way, regrip(inTwo.id, 1))
    return loosened ? freeing(loosened, hands, keep) : []
  }
  return held.flatMap((item) => [putAway(way, item.id), then(way, { kind: 'slingShield', args: [item.id] })]
    .flatMap((away) => (away ? freeing(away, hands, keep) : [])))
}

// The weapon held in two hands, a hand freed for it first.
function inTwoHands(way: Switch, itemId: string): Switch[] {
  return freeing(way, 1, itemId).flatMap((w) => then(w, regrip(itemId, 2)) ?? [])
}

export function getSwitches(c: CampaignCharacter): Switch[] {
  const start: Switch = { moves: [], after: c, cost: { AP: 0, STA: 0 }, paid: 0 }
  const out: Switch[] = []
  for (const item of c.held) {
    if (!getItemWeapon(item)) continue
    if (getGrip(c, item.id) < 2) {
      out.push(...inTwoHands(start, item.id))
      continue
    }
    const loosened = then(start, regrip(item.id, 1))
    if (loosened) out.push(loosened)
  }
  for (const [key, container] of Object.entries(getOpenContainers(c))) {
    for (const slot of SlotKindSchema.options) {
      for (const item of container.slots[slot].items) {
        if (item.broken || !getItemWeapon(item)) continue
        for (const way of freeing(start, 1, '')) {
          const drawn = then(way, { kind: 'drawItem', args: [key, item.id] })
          if (!drawn) continue
          out.push(drawn)
          const unit = drawn.after.held.find((h) => !way.after.held.some((o) => o.id === h.id))
          if (unit) out.push(...inTwoHands(drawn, unit.id))
        }
      }
    }
  }
  if (c.onBack) {
    out.push(...freeing(start, 1, '').flatMap((way) => then(way, { kind: 'unslingShield', args: [] }) ?? []))
  }
  return out
}
