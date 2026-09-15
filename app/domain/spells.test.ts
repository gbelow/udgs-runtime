import { describe, it, expect } from 'vitest'
import { SpellSchema } from './types'
import catalog from '../assets/spells.json'

// The catalog crosses from untyped JSON into the schema here: every entry
// must carry every field it claims, so an edit that drops or misnames one
// fails instead of silently taking a default.
describe('spells.json', () => {
  it.each(Object.entries(catalog as Record<string, unknown>))('%s parses losslessly — nothing stripped, nothing defaulted', (key, raw) => {
    expect(SpellSchema.parse(raw), key).toEqual(raw)
  })
})
