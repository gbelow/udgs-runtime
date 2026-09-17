'use client'
import { ReactNode } from 'react'
import { emptyValue, Field, FieldType } from '../../forms/schemaFields'

// Renders any described schema as a form: scalars as inputs, enums as
// selects, objects as fieldsets, arrays as lists with add/remove, a
// discriminated union as a variant select. It knows nothing about what the
// fields mean — the schema is the field list and the overrides are the only
// place a catalog says "this field wants a different widget".

// An override replaces the widget for every field at a path, where the path
// is the field names from the root joined by '.', array indices left out
// ("stages.requirements.name"). It receives the enclosing object so a widget
// can depend on a sibling (a requirement's name list depends on its kind);
// returning null hides the field.
export type FieldOverride = (props: { value: unknown; onChange: (v: unknown) => void; parent: Record<string, unknown> }) => ReactNode
export type Overrides = Record<string, FieldOverride>

type ValueProps = { type: FieldType; value: unknown; onChange: (v: unknown) => void; path: string; overrides: Overrides; parent: Record<string, unknown> }

const input = 'bg-transparent border border-gray-600 rounded px-1 text-sm w-full'
const button = 'border border-gray-500 rounded px-1 text-xs hover:bg-gray-600'

function join(path: string, name: string): string {
  return path ? `${path}.${name}` : name
}

// What fits inside a label on one row: a scalar, or an unset-able scalar.
function isScalar(type: FieldType): boolean {
  if (type.kind === 'nullable' || type.kind === 'optional') return isScalar(type.inner)
  return ['string', 'number', 'boolean', 'literal', 'enum'].includes(type.kind)
}

// A fieldset, possibly one that can be left unset.
function isRecord(type: FieldType): boolean {
  if (type.kind === 'nullable' || type.kind === 'optional') return isRecord(type.inner)
  return type.kind === 'object'
}

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined
}

// A nullable or optional field: a checkbox that sets it to the empty value of
// its kind or clears it back to its absent form.
function Unsettable({ type, value, onChange, path, overrides, parent }: ValueProps & { type: Extract<FieldType, { kind: 'nullable' | 'optional' }> }) {
  const absent = type.kind === 'nullable' ? null : undefined
  return (
    <div className='flex flex-row gap-2 items-start'>
      <input type='checkbox' aria-label={`${path} set`} checked={isSet(value)} onChange={(e) => onChange(e.target.checked ? emptyValue(type.innerSchema) : absent)} />
      {isSet(value) ?
        <div className='grow'><Value type={type.inner} value={value} onChange={onChange} path={path} overrides={overrides} parent={parent} /></div>
        : <span className='text-xs text-gray-500'>none</span>}
    </div>
  )
}

// An array of an enum is a set: one checkbox per option, kept in the enum's
// own order so the saved list reads the same however it was ticked.
function EnumSet({ options, value, onChange, path }: { options: string[]; value: unknown; onChange: (v: unknown) => void; path: string }) {
  const picked = new Set((value as unknown[]) ?? [])
  const toggle = (option: string, on: boolean) => {
    const next = new Set(picked)
    if (on) next.add(option); else next.delete(option)
    onChange(options.filter((o) => next.has(o)))
  }
  return (
    <div className='flex flex-row flex-wrap gap-x-3 gap-y-1'>
      {options.map((option) => (
        <label key={option} className='flex flex-row gap-1 items-center text-sm text-gray-200'>
          <input type='checkbox' aria-label={`${path} ${option}`} checked={picked.has(option)} onChange={(e) => toggle(option, e.target.checked)} />
          {option}
        </label>
      ))}
    </div>
  )
}

function Value({ type, value, onChange, path, overrides, parent }: ValueProps) {
  switch (type.kind) {
    case 'string':
      return <input className={input} type='text' value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    case 'number':
      return <input className={input} type='number' step='any' value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />
    case 'boolean':
      return <input type='checkbox' checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
    case 'literal':
      return <span className='text-sm text-gray-400'>{type.value}</span>
    case 'enum':
      return (
        <select className={input} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {type.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    case 'object':
      return <Fields fields={type.fields} value={value as Record<string, unknown>} onChange={onChange} path={path} overrides={overrides} />
    case 'array': {
      if (type.element.kind === 'enum') return <EnumSet options={type.element.options} value={value} onChange={onChange} path={path} />
      const items = (value as unknown[]) ?? []
      const set = (i: number, v: unknown) => onChange(items.map((it, j) => (j === i ? v : it)))
      const remove = (i: number) => onChange(items.filter((_, j) => j !== i))
      const add = () => onChange([...items, emptyValue(type.elementSchema)])
      const removable = items.length > type.min
      const element = (item: unknown, i: number) => <Value type={type.element} value={item} onChange={(v) => set(i, v)} path={path} overrides={overrides} parent={parent} />
      const removeButton = (i: number) => <input type='button' className={button} value='×' aria-label={`remove ${path} ${i + 1}`} disabled={!removable} onClick={() => remove(i)} />
      // a list of scalars is one row per value; a list of records is one card
      // per record, numbered and captioned by its name if it has one, so where
      // one ends and the next begins is visible
      const cards = !isScalar(type.element)
      const caption = (item: unknown) => {
        const name = (item as Record<string, unknown> | null)?.name
        return typeof name === 'string' && name ? name : ''
      }
      return (
        <div className='flex flex-col gap-2'>
          {items.map((item, i) => cards ? (
            <div key={i} className='flex flex-col gap-1 border border-gray-600 rounded bg-gray-800/40 p-2'>
              <div className='flex flex-row items-center'>
                <span className='text-xs font-mono text-gray-400'>#{i + 1}</span>
                <span className='text-xs text-gray-300 pl-2'>{caption(item)}</span>
                <span className='grow' />
                {removeButton(i)}
              </div>
              {element(item, i)}
            </div>
          ) : (
            <div key={i} className='flex flex-row gap-1 items-center'>
              <div className='grow'>{element(item, i)}</div>
              {removeButton(i)}
            </div>
          ))}
          <div><input type='button' className={button} value='+ add' aria-label={`add ${path}`} onClick={add} /></div>
        </div>
      )
    }
    case 'nullable':
    case 'optional':
      return <Unsettable type={type} value={value} onChange={onChange} path={path} overrides={overrides} parent={parent} />
    case 'union': {
      const record = (value ?? {}) as Record<string, unknown>
      const current = String(record[type.discriminator] ?? type.options[0]?.value)
      const option = type.options.find((o) => o.value === current) ?? type.options[0]
      return (
        <div className='flex flex-col gap-1'>
          <select className={input} value={current} aria-label={`${path} ${type.discriminator}`}
            onChange={(e) => {
              const next = type.options.find((o) => o.value === e.target.value)
              if (next) onChange(emptyValue(next.schema))
            }}>
            {type.options.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
          </select>
          {option ? <Fields fields={option.fields} value={record} onChange={onChange} path={path} overrides={overrides} /> : null}
        </div>
      )
    }
    case 'unknown':
      return <span className='text-xs text-red-400'>unsupported field</span>
  }
}

function Fields({ fields, value, onChange, path, overrides }: { fields: Field[]; value: Record<string, unknown>; onChange: (v: unknown) => void; path: string; overrides: Overrides }) {
  const record = value ?? {}
  const set = (name: string, v: unknown) => onChange({ ...record, [name]: v })
  // a scalar, or anything an override widgets, sits inside its label; a nested
  // block only carries a caption
  const inline = (field: Field) => isScalar(field.type) || overrides[join(path, field.name)] !== undefined

  const rendered = fields.map((field) => {
    const fieldPath = join(path, field.name)
    const override = overrides[fieldPath]
    const widget = override
      ? override({ value: record[field.name], onChange: (v) => set(field.name, v), parent: record })
      : <Value type={field.type} value={record[field.name]} onChange={(v) => set(field.name, v)} path={fieldPath} overrides={overrides} parent={record} />
    return { field, widget, inline: inline(field) }
  }).filter(({ widget }) => widget !== null) // an override that renders nothing hides the field

  // the inline fields share one wrapping row; every nested block follows on
  // its own line, ruled off from its siblings
  const row = rendered.filter((r) => r.inline)
  const blocks = rendered.filter((r) => !r.inline)
  return (
    <div className='flex flex-col gap-1'>
      {row.length > 0 && (
        <div className='flex flex-row flex-wrap gap-2'>
          {row.map(({ field, widget }) => <label key={field.name} className='flex flex-col text-xs text-gray-400 min-w-16'>{field.name}{widget}</label>)}
        </div>
      )}
      {blocks.map(({ field, widget }) => (
        <div key={field.name} className='flex flex-col text-xs text-gray-400'>
          <span>{field.name}</span>
          {isRecord(field.type) ? <div className='border-l border-gray-700 pl-2 py-1'>{widget}</div> : widget}
        </div>
      ))}
    </div>
  )
}

export function SchemaForm({ type, value, onChange, overrides = {} }: { type: FieldType; value: unknown; onChange: (v: unknown) => void; overrides?: Overrides }) {
  return <Value type={type} value={value} onChange={onChange} path='' overrides={overrides} parent={{}} />
}
