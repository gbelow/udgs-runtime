import { ItemEntrySchema, type Consume, type Effect, type Item } from '../../types'
import itemsCatalog from '../../../assets/items.json'

// gear.tex "Potions and Medicine": what a dose of each catalog entry does,
// by name. A potion taken is kept on its taker by name and its effects read
// from here while it lasts, so nothing copied into a character goes stale.
const byName = new Map<string, Consume>(Object.values(itemsCatalog as Record<string, unknown>).flatMap((raw) => {
  const entry = ItemEntrySchema.parse(raw)
  return entry.consume ? [[entry.name, entry.consume] as const] : []
}))

export function getCatalogConsume(name: string): Consume | null {
  return byName.get(name) ?? null
}


// What a dose of the item does: its own, or, for an item stamped before
// its entry said, the entry's.
export function getConsume(item: Item): Consume | null {
  return item.consume ?? getCatalogConsume(item.name)
}

// "Potions add an effect to the character for a certain duration": what
// stays on whoever took it rather than landing once.
export function isLasting(effect: Effect): boolean {
  return effect.type === 'buff' || effect.type === 'suppression'
}

const lasting = new Map<string, Effect[]>([...byName].map(([name, consume]) => [name, consume.effects.filter(isLasting)]))
const NONE: Effect[] = []

// The effects a potion taken keeps on its taker while it lasts.
export function getLastingEffects(name: string): Effect[] {
  return lasting.get(name) ?? NONE
}

// The doses a whole unit of the item holds: its entry's, or its own.
export function getUnitDoses(item: Item): number {
  return Math.max(1, getCatalogConsume(item.name)?.doses ?? getConsume(item)?.doses ?? 1)
}

// The doses the stack holds: what is left in the unit in use, and every
// other unit whole.
export function getDosesLeft(item: Item): number {
  const consume = getConsume(item)
  return consume ? consume.doses + (item.amount - 1) * getUnitDoses(item) : 0
}
