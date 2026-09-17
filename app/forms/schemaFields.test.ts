import { describe, it, expect } from 'vitest'
import { describeSchema, emptyValue, FieldType } from './schemaFields'
import { AbilityFamilySchema, ArmorSchema, ContainerSchema, ItemSchema, SpellSchema, WeaponSchema } from '../domain/types'

const CATALOGS = {
  AbilityFamilySchema, SpellSchema, WeaponSchema, ArmorSchema, ItemSchema, ContainerSchema,
}

function kinds(type: FieldType): string[] {
  switch (type.kind) {
    case 'object': return [type.kind, ...type.fields.flatMap((f) => kinds(f.type))]
    case 'array': return [type.kind, ...kinds(type.element)]
    case 'nullable': case 'optional': return [type.kind, ...kinds(type.inner)]
    case 'union': return [type.kind, ...type.options.flatMap((o) => o.fields.flatMap((f) => kinds(f.type)))]
    default: return [type.kind]
  }
}

// The describer reads Zod's runtime definitions, which the type system cannot
// see through: a schema construct it does not recognise would drop out of the
// form silently. Every catalog must describe completely, and its empty value
// must be something the schema itself accepts unchanged.
describe('describeSchema', () => {
  it.each(Object.entries(CATALOGS))('%s describes every field with a known kind', (_name, schema) => {
    const described = describeSchema(schema)
    expect(described.kind).toBe('object')
    if (described.kind !== 'object') return
    expect(described.fields.map((f) => f.name)).toEqual(Object.keys(schema.def.shape))
    expect(kinds(described)).not.toContain('unknown')
  })

  it.each(Object.entries(CATALOGS))('%s accepts its own empty value losslessly', (_name, schema) => {
    const empty = emptyValue(schema)
    expect(schema.parse(empty)).toEqual(empty)
  })
})
