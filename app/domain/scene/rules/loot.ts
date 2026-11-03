import type { Character, Container, Item, SlotKind } from '../../types'
import { SlotKindSchema } from '../../types'
import { getContainerItem } from '../../item/rules/containers'
import { getDrawCost } from '../../item/rules/costs'
import { getActionCost, type ActionCost } from '../../character/rules/actionCosts'
import { getDoffCost } from '../../character/rules/donning'
import { isCombatStarted } from './started'
import type { Body, Coord, LootSource, SceneState } from '../types'
import { getFightName } from './fighters'
import { getReachableFloor, isInReach } from './floor'

// combat.tex "Standard Action": opening is an object interaction, and so is
// taking what is in it. What lies in the hands or on the back of a body, or
// loose on the floor, needs no opening; what is in a container does.

// An item to be had, and where it lies: the cell, and the slot group when it
// is in a container.
export type LootItem = { item: Item; from: LootSource; cell: Coord | null; slot: SlotKind | null }

// A container that can be opened, and whether it has been. `key` is what
// `SceneState.opened` and an `open` action name it by.
export type Openable = { key: string; name: string; opened: boolean }

export function getPackKey(bodyId: string, container: string): string {
  return `${bodyId}:${container}`
}

export function getSourceKey(from: LootSource): string {
  switch (from.kind) {
    case 'floor': return 'floor'
    case 'chest': return `chest:${from.chest}`
    case 'body': return `body:${from.body}`
    case 'pack': return `pack:${getPackKey(from.body, from.container)}`
    case 'worn': return `worn:${from.body}`
    case 'wornPack': return `wornPack:${getPackKey(from.body, from.container)}`
  }
}

export function isSameSource(a: LootSource, b: LootSource): boolean {
  return getSourceKey(a) === getSourceKey(b)
}

export function getContainerItems(container: Container): Item[] {
  return SlotKindSchema.options.flatMap((slot) => container.slots[slot].items)
}

// The items of a container, each with the slot group it sits in.
function slotted(container: Container): { item: Item; slot: SlotKind }[] {
  return SlotKindSchema.options.flatMap((slot) => container.slots[slot].items.map((item) => ({ item, slot })))
}

// The dead within reach of the character's cells.
export function getReachableBodies(state: SceneState, id: string): Body[] {
  return state.bodies.filter((b) => isInReach(state, id, b.cell))
}

// The containers within reach that hold something to rummage through: those
// lying on the floor, and those a body wears.
export function getOpenables(state: SceneState, id: string): Openable[] {
  const chests = getReachableFloor(state, id)
    .filter((f) => f.item.container)
    .map((f) => ({ key: f.item.id, name: f.item.name, opened: state.opened.includes(f.item.id) }))
  const packs = getReachableBodies(state, id).flatMap((b) => Object.entries(b.character.containers).map(([container, c]) => {
    const key = getPackKey(b.character.id, container)
    return { key, name: `${getFightName(state, b.character.id)}'s ${c.name || c.kind}`, opened: state.opened.includes(key) }
  }))
  return [...chests, ...packs]
}

// Every item the character could take now: what lies loose, everything a body
// has on it (in its hands, on its back, worn, or a container worn) and what is
// in a container opened.
export function getReachableLoot(state: SceneState, id: string): LootItem[] {
  const floor = getReachableFloor(state, id)
  const lying = floor.map((f): LootItem => ({ item: f.item, from: { kind: 'floor' }, cell: f.cell, slot: null }))
  const inChests = floor
    .filter((f) => f.item.container && state.opened.includes(f.item.id))
    .flatMap((f) => slotted(f.item.container!).map(({ item, slot }): LootItem => ({ item, from: { kind: 'chest', chest: f.item.id }, cell: f.cell, slot })))
  const onBodies = getReachableBodies(state, id).flatMap((b) => {
    const c = b.character
    const on = (item: Item, from: LootSource): LootItem => ({ item, from, cell: b.cell, slot: null })
    const carried = [...c.held, ...(c.onBack ? [c.onBack] : [])].map((item) => on(item, { kind: 'body', body: c.id }))
    const worn = c.worn ? [on(c.worn, { kind: 'worn', body: c.id })] : []
    const packs = Object.entries(c.containers).map(([container, pack]) => on({ ...getContainerItem(container, pack), id: getPackKey(c.id, container) }, { kind: 'wornPack', body: c.id, container }))
    const packed = Object.entries(c.containers)
      .filter(([container]) => state.opened.includes(getPackKey(c.id, container)))
      .flatMap(([container, pack]) => slotted(pack).map(({ item, slot }): LootItem => ({ ...on(item, { kind: 'pack', body: c.id, container }), slot })))
    return [...carried, ...worn, ...packs, ...packed]
  })
  return [...lying, ...inChests, ...onBodies]
}

// What someone carries that a hand could take off them without opening
// anything: what is in their hands and on their back, and everything in the
// containers they wear (combat.tex "Theft").
export function getCarriedBy(c: Character, cell: Coord | null): LootItem[] {
  const on = (item: Item, from: LootSource, slot: SlotKind | null = null): LootItem => ({ item, from, cell, slot })
  const held = [...c.held, ...(c.onBack ? [c.onBack] : [])].map((item) => on(item, { kind: 'body', body: c.id }))
  const packed = Object.entries(c.containers).flatMap(([container, pack]) => slotted(pack).map(({ item, slot }) => on(item, { kind: 'pack', body: c.id, container }, slot)))
  return [...held, ...packed]
}

// What taking the item into a hand costs the looter: what their own inventory
// would ask for it. Lying loose or held by a body, a standard action
// (combat.tex "Standard Action"); out of a container's slot, the price of
// drawing from that slot (combat.tex "Drawing items in combat"); armor, the
// price of doffing it, which a rigid or large armor has none of in a fight
// (gear.tex "Donning and Doffing armor"). Null is what cannot be taken now.
export function getLootCost(state: SceneState, c: Character, loot: LootItem): ActionCost | null {
  switch (loot.from.kind) {
    case 'chest':
    case 'pack': return loot.slot ? getDrawCost(c, loot.slot, loot.item) : null
    case 'worn': return isCombatStarted(state) ? getDoffCost({ ...c, worn: loot.item }, null) : { AP: 0, STA: 0 }
    default: return getActionCost(c, 'standardAction')
  }
}

export function findLoot(state: SceneState, id: string, from: LootSource, itemId: string): LootItem | null {
  return getReachableLoot(state, id).find((l) => l.item.id === itemId && isSameSource(l.from, from)) ?? null
}

// Where a container named by `key` lies, when it can be opened: within reach
// and not yet open.
export function findOpenable(state: SceneState, id: string, key: string): Openable | null {
  return getOpenables(state, id).find((o) => o.key === key && !o.opened) ?? null
}

// What a looted body is called, for a panel to say whose it is.
export function getLootLabel(state: SceneState, from: LootSource): string {
  switch (from.kind) {
    case 'floor': return ''
    case 'chest': return state.floor.find((f) => f.item.id === from.chest)?.item.name ?? ''
    case 'body': return getFightName(state, from.body)
    case 'pack':
    case 'wornPack': return `${getFightName(state, from.body)}'s ${state.bodies.find((b) => b.character.id === from.body)?.character.containers[from.container]?.name || 'pack'}`
    case 'worn': return getFightName(state, from.body)
  }
}
