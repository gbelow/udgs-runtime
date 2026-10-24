// A set of catalog entries as one table, to read their values side by side.

export type ComparisonEntry = { key: string; name: string; value: Record<string, unknown> }

// A cell as text, and as a number where the stored value is one.
export type ComparisonCell = { text: string; number: number | null }

export type ComparisonRow = { id: string; entry: string; cells: ComparisonCell[] }

export type Comparison = { columns: string[]; rows: ComparisonRow[] }

// The column rows are ordered by; none is the entry's name.
export type ComparisonSort = { column: string | null; descending: boolean }

type Flat = Map<string, ComparisonCell>

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isScalar = (value: unknown): value is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof value)

const cellOf = (value: string | number | boolean): ComparisonCell => ({ text: String(value), number: typeof value === 'number' ? value : null })

function flatten(value: unknown, path: string, out: Flat): void {
  if (isScalar(value)) {
    if (value !== '') out.set(path, cellOf(value))
  } else if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isScalar)) out.set(path, { text: value.join(', '), number: null })
    else value.forEach((v, i) => flatten(v, `${path}.${i}`, out))
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([k, v]) => flatten(v, path ? `${path}.${k}` : k, out))
  }
}

// The one field of an entry that holds a list of records, where each record
// is a row of its own (a weapon's attacks); none where there are several or
// none, and the entry is one row.
function getRowsField(value: Record<string, unknown>): string | null {
  const lists = Object.entries(value).filter(([, v]) => Array.isArray(v) && v.length > 0 && v.every(isRecord))
  return lists.length === 1 ? lists[0][0] : null
}

// What the entry's name already says is not a column of its own.
function getShared(entry: ComparisonEntry, field: string | null): Flat {
  const shared: Flat = new Map()
  Object.entries(entry.value).filter(([k]) => k !== field).forEach(([k, v]) => flatten(v, k, shared))
  shared.forEach((cell, path) => { if (cell.text === entry.name) shared.delete(path) })
  return shared
}

function getEntryRows(entry: ComparisonEntry): { id: string; entry: string; flat: Flat }[] {
  const field = getRowsField(entry.value)
  const shared = getShared(entry, field)
  if (field === null) return [{ id: entry.key, entry: entry.name, flat: shared }]
  return (entry.value[field] as Record<string, unknown>[]).map((record, i) => {
    const own: Flat = new Map()
    flatten(record, '', own)
    const flat: Flat = new Map(shared)
    own.forEach((cell, path) => flat.set(shared.has(path) ? `${field}.${path}` : path, cell))
    return { id: `${entry.key}:${i}`, entry: entry.name, flat }
  })
}

const compareCells = (a: ComparisonCell, b: ComparisonCell): number =>
  a.number !== null && b.number !== null ? a.number - b.number : a.text.localeCompare(b.text)

const byEntry = (a: ComparisonRow, b: ComparisonRow): number => a.entry.localeCompare(b.entry)

// The entries as rows, one per entry or per record of its list, under the
// fields any of them has, in the order they first appear; a field none of
// them sets is no column. Rows go by entry name unless sorted by a column,
// those without a value last and equal values by entry name; the rows of one
// entry keep their order.
export function getComparison(entries: ComparisonEntry[], sort: ComparisonSort = { column: null, descending: false }): Comparison {
  const flats = entries.flatMap(getEntryRows)
  const columns = [...new Set(flats.flatMap((r) => [...r.flat.keys()]))]
  const empty: ComparisonCell = { text: '', number: null }
  const rows = flats.map(({ id, entry, flat }) => ({ id, entry, cells: columns.map((c) => flat.get(c) ?? empty) }))
  const direction = sort.descending ? -1 : 1
  const at = sort.column === null ? -1 : columns.indexOf(sort.column)
  if (at < 0) return { columns, rows: [...rows].sort((a, b) => direction * byEntry(a, b)) }
  const present = (r: ComparisonRow) => r.cells[at].text !== ''
  const sorted = [...rows].sort((a, b) => Number(!present(a)) - Number(!present(b)) || direction * compareCells(a.cells[at], b.cells[at]) || byEntry(a, b))
  return { columns, rows: sorted }
}
