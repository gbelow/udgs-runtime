import type { Container, Item } from '../../types'
import { SlotKindSchema } from '../../types'
import type { Body, Coord, LootSource, SceneState } from '../types'
import { getFightName } from './fighters'
import { getReachableFloor, isInReach } from './floor'

// combat.tex "Standard Action": opening is an object interaction, and so is
// taking what is in it. What lies in the hands or on the back of a body, or
// loose on the floor, needs no opening; what is in a container does.

// An item to be had, and where it lies.
export type LootItem = { item: Item; from: LootSource; cell: Coord | null }

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
  }
}

export function isSameSource(a: LootSource, b: LootSource): boolean {
  return getSourceKey(a) === getSourceKey(b)
}

export function getContainerItems(container: Container): Item[] {
  return SlotKindSchema.options.flatMap((slot) => container.slots[slot].items)
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

// Every item the character could take now: what lies loose, what a body holds
// in its hands or carries on its back, and what is in a container opened.
export function getReachableLoot(state: SceneState, id: string): LootItem[] {
  const floor = getReachableFloor(state, id)
  const lying = floor.map((f): LootItem => ({ item: f.item, from: { kind: 'floor' }, cell: f.cell }))
  const inChests = floor
    .filter((f) => f.item.container && state.opened.includes(f.item.id))
    .flatMap((f) => getContainerItems(f.item.container!).map((item): LootItem => ({ item, from: { kind: 'chest', chest: f.item.id }, cell: f.cell })))
  const onBodies = getReachableBodies(state, id).flatMap((b) => {
    const c = b.character
    const carried = [...c.held, ...(c.onBack ? [c.onBack] : [])].map((item): LootItem => ({ item, from: { kind: 'body', body: c.id }, cell: b.cell }))
    const packed = Object.entries(c.containers)
      .filter(([container]) => state.opened.includes(getPackKey(c.id, container)))
      .flatMap(([container, pack]) => getContainerItems(pack).map((item): LootItem => ({ item, from: { kind: 'pack', body: c.id, container }, cell: b.cell })))
    return [...carried, ...packed]
  })
  return [...lying, ...inChests, ...onBodies]
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
    case 'pack': return `${getFightName(state, from.body)}'s ${state.bodies.find((b) => b.character.id === from.body)?.character.containers[from.container]?.name || 'pack'}`
  }
}
