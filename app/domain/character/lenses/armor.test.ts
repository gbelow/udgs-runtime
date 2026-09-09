import { describe, it, expect } from 'vitest'
import armorsCatalog from '../../../assets/armors.json'
import { ArmorSchema } from '../../types'

const catalog = armorsCatalog as Record<string, unknown>
const entries = Object.entries(catalog)

// The catalog is the transcription of the gear.tex "Armors" table — one copy,
// diffable against the book by eye. These tests check the properties the file
// itself cannot state, never the numbers in it.
describe('armors.json', () => {
  it.each(entries)('%s parses losslessly — nothing stripped, nothing defaulted', (key, raw) => {
    expect(ArmorSchema.parse(raw), key).toEqual(raw)
  })

})
