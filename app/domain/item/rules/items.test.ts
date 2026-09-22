import { describe, it, expect } from 'vitest'
import { getCatalogItem, getItemWeapon, getItemArmor, getItemScale, GEAR_SIZE } from './items'
import { ArmorSchema, ItemSchema, WeaponSchema } from '../../types'
import weaponsCatalog from '../../../assets/weapons.json'
import armorsCatalog from '../../../assets/armors.json'
import itemsCatalog from '../../../assets/items.json'

const weapons = Object.keys(weaponsCatalog as Record<string, unknown>)
const armors = Object.keys(armorsCatalog as Record<string, unknown>)

// An item with a refId is a pointer into a catalog; resolving it is what lets a
// weapon sitting in a backpack be equipped as the real thing. Driven off the
// catalogs, so an entry added to either is resolved without a new case. An
// item is stamped from its own template, at the bulk the book lists it at, so
// it comes back as printed rather than scaled (gear.tex "Size Scaling").
const template = (type: 'weapon' | 'armor', refId: string) =>
  Object.values(itemsCatalog as Record<string, unknown>).map((raw) => ItemSchema.parse(raw)).find((t) => t.type === type && t.refId === refId)
  ?? ItemSchema.parse({ name: refId, type, refId })

describe('resolving a catalog item', () => {
  it.each(weapons)('resolves the weapon "%s"', (refId) => {
    const item = template('weapon', refId)
    expect(getItemWeapon(item)).toEqual(WeaponSchema.parse((weaponsCatalog as Record<string, unknown>)[refId]))
    expect(getItemArmor(item)).toBeUndefined()
  })

  it.each(armors)('resolves the armor "%s"', (refId) => {
    const item = template('armor', refId)
    expect(getItemArmor(item)).toEqual({ ...ArmorSchema.parse((armorsCatalog as Record<string, unknown>)[refId]), scale: GEAR_SIZE })
    expect(getItemWeapon(item)).toBeUndefined()
  })
})

// Either the catalog entry or nothing: an item that names no entry, names one
// that is gone, or is not of that kind at all resolves to undefined rather
// than to a half-built object.
describe('resolution is total', () => {
  const unresolvable = [
    { label: 'no refId', raw: { name: 'Rope', type: 'weapon' } },
    { label: 'an unknown refId', raw: { type: 'weapon', refId: 'NoSuchWeapon' } },
    { label: 'the wrong type', raw: { name: 'Dagger', type: 'misc', refId: 'Dagger' } },
    { label: 'a flavor item', raw: { name: 'Rusty Key', description: 'opens something, somewhere' } },
    { label: 'an empty item', raw: {} },
  ]

  it.each(unresolvable.map((c) => [c.label, c.raw] as const))('%s resolves to nothing', (_label, raw) => {
    const item = ItemSchema.parse(raw)
    expect(getItemWeapon(item)).toBeUndefined()
    expect(getItemArmor(item)).toBeUndefined()
  })
})

// The catalog is the transcription of the gear.tex item lists and the Bulk
// column of its weapon, shield and armor tables. An entry is a template: `id`
// and `amount` belong to the stack stamped from it, so they are the only
// fields the parse may add. A template that names a catalog entry must name
// one that exists, or every item stamped from it is a dead pointer.
describe('items.json', () => {
  const entries = Object.entries(itemsCatalog as Record<string, unknown>)

  it.each(entries)('%s parses losslessly — nothing stripped, nothing defaulted', (key, raw) => {
    const { id: _id, ...parsed } = ItemSchema.parse(raw)
    expect(parsed, key).toEqual({ amount: 1, ...(raw as object) })
  })

  it.each(entries)('%s stamps a fresh stack each time it is drawn', (key) => {
    const first = getCatalogItem(key, 3)
    const second = getCatalogItem(key, 3)
    expect(first, key).toBeDefined()
    expect(second?.id).not.toBe(first?.id)
    expect({ ...second, id: '' }).toEqual({ ...first, id: '' })
  })

  // An item carries its size in its bulk, so stamping a template at a size and
  // reading the size back off the stamp must agree at every size a creature
  // can be — for the flavor entries too, which have a template to be measured
  // against even though nothing resolves through them.
  it.each(entries)('%s reads back the size it was stamped at', (key) => {
    for (let scale = 1; scale <= 7; scale++) {
      expect(getItemScale(getCatalogItem(key, 1, scale)!), `${key} at size ${scale}`).toBe(scale)
    }
  })

  it.each(entries)('%s resolves whatever it references', (key, raw) => {
    const item = ItemSchema.parse(raw)
    if (!item.refId) return
    const resolved = item.type === 'weapon' ? getItemWeapon(item) : item.type === 'armor' ? getItemArmor(item) : undefined
    expect(resolved, key).toBeDefined()
  })
})
