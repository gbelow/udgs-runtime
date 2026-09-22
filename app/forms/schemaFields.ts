import { z } from 'zod'

// Reads a Zod schema's runtime definition into a tree the generic form can
// render. The catalogs are all Zod objects, so one walk over the schema is
// every catalog editor's field list; a schema change reaches the form the same
// day without a hand-written field list to keep in step.

export type FieldType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'literal'; value: string }
  | { kind: 'enum'; options: string[] }
  | { kind: 'object'; fields: Field[] }
  | { kind: 'array'; element: FieldType; elementSchema: z.ZodType; min: number }
  | { kind: 'nullable'; inner: FieldType; innerSchema: z.ZodType }
  // absent from the record altogether, so a saved entry carries the field only
  // while it is set
  | { kind: 'optional'; inner: FieldType; innerSchema: z.ZodType }
  | { kind: 'union'; discriminator: string; options: { value: string; fields: Field[]; schema: z.ZodType }[] }
  | { kind: 'unknown' }

// A node keeps its schema so the form can ask `emptyValue` for a fresh
// element or variant without re-walking from the root.
export type Field = { name: string; type: FieldType; schema: z.ZodType }

// The parts of zod 4's runtime definition this walk reads; which are present
// depends on `type`.
type Def = {
  type: string
  innerType?: z.ZodType
  in?: z.ZodType
  values?: unknown[]
  entries?: Record<string, unknown>
  element?: z.ZodType
  shape?: Record<string, z.ZodType>
  options?: z.ZodType[]
  discriminator?: string
  checks?: { _zod: { def: { check: string; minimum?: number } } }[]
  defaultValue?: unknown
  getter?: () => z.ZodType
}

function def(schema: z.ZodType): Def {
  return schema.def as unknown as Def
}

// zod 4 keeps the wrapped schema under `innerType` for default/prefault/
// catch, and a transform is a pipe whose input side is the authored shape, so
// a field's own kind is read through those wrappers. An optional is not a
// wrapper to see through: it is the field's kind, since the form has to offer
// leaving it unset.
function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema
  for (;;) {
    const d = def(s)
    if ((d.type === 'default' || d.type === 'prefault' || d.type === 'catch') && d.innerType) s = d.innerType
    else if (d.type === 'pipe' && d.in) s = d.in
    // a schema declared ahead of its definition reads the same as the definition
    else if (d.type === 'lazy' && d.getter) s = d.getter()
    else return s
  }
}

function minLength(d: Def): number {
  return d.checks?.find((c) => c._zod.def.check === 'min_length')?._zod.def.minimum ?? 0
}

function describeFields(shape: Record<string, z.ZodType>): Field[] {
  return Object.entries(shape).map(([name, sub]) => ({ name, type: describeSchema(sub), schema: sub }))
}

export function describeSchema(schema: z.ZodType): FieldType {
  const s = unwrap(schema)
  const d = def(s)
  switch (d.type) {
    case 'string': return { kind: 'string' }
    case 'number': return { kind: 'number' }
    case 'boolean': return { kind: 'boolean' }
    case 'literal': return { kind: 'literal', value: String(d.values?.[0]) }
    case 'enum': return { kind: 'enum', options: Object.keys(d.entries ?? {}) }
    case 'object': return { kind: 'object', fields: describeFields(d.shape ?? {}) }
    case 'array':
      return d.element ? { kind: 'array', element: describeSchema(d.element), elementSchema: d.element, min: minLength(d) } : { kind: 'unknown' }
    case 'nullable':
      return d.innerType ? { kind: 'nullable', inner: describeSchema(d.innerType), innerSchema: d.innerType } : { kind: 'unknown' }
    case 'optional':
      return d.innerType ? { kind: 'optional', inner: describeSchema(d.innerType), innerSchema: d.innerType } : { kind: 'unknown' }
    case 'union': {
      const discriminator = d.discriminator
      if (!discriminator) return { kind: 'unknown' }
      return {
        kind: 'union',
        discriminator,
        options: (d.options ?? []).map((option) => {
          const fields = describeFields(def(unwrap(option)).shape ?? {})
          const tag = fields.find((f) => f.name === discriminator)?.type
          return { value: tag?.kind === 'literal' ? tag.value : '', fields: fields.filter((f) => f.name !== discriminator), schema: option }
        }),
      }
    }
    default: return { kind: 'unknown' }
  }
}

// A value of the described shape with every field at the schema's default —
// what "add" produces for an array element or a fresh union variant. Built
// from the schema itself so defaults have one owner; a schema without a
// declared default gets the empty member of its kind.
export function emptyValue(schema: z.ZodType): unknown {
  if (def(schema).type === 'default') return structuredClone(def(schema).defaultValue)
  const s = unwrap(schema)
  const d = def(s)
  switch (d.type) {
    case 'object':
      return Object.fromEntries(Object.entries(d.shape ?? {}).map(([name, sub]) => [name, emptyValue(sub)]))
    case 'union':
      return d.options?.[0] ? emptyValue(d.options[0]) : undefined
    case 'array':
      return Array.from({ length: minLength(d) }, () => (d.element ? emptyValue(d.element) : undefined))
    case 'literal': return d.values?.[0]
    case 'enum': return Object.keys(d.entries ?? {})[0]
    case 'string': return ''
    case 'number': return 0
    case 'boolean': return false
    case 'nullable': return null
    case 'optional': return undefined
    default: return undefined
  }
}
