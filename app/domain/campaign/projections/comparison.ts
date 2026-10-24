// A set of catalog entries as one table, to read their values side by side.

export type ComparisonEntry = { key: string; name: string; value: Record<string, unknown> }

// A cell as text, and as a number where the stored value is one.
export type ComparisonCell = { text: string; number: number | null }

// A record of the entry's list (a weapon's attack), a row of its own under
// the entry's; the first shares the entry's row.
export type ComparisonChild = { id: string; cells: ComparisonCell[] }

export type ComparisonRow = { id: string; key: string; entry: string; cells: ComparisonCell[]; children: ComparisonChild[] }

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
// none.
function getRowsField(value: Record<string, unknown>): string | null {
  const lists = Object.entries(value).filter(([, v]) => Array.isArray(v) && v.length > 0 && v.every(isRecord))
  return lists.length === 1 ? lists[0][0] : null
}

type FlatEntry = { key: string; entry: string; own: Flat; children: Flat[] }

// What the entry's name already says is not a column of its own.
function getFlatEntry(entry: ComparisonEntry): FlatEntry {
  const field = getRowsField(entry.value)
  const own: Flat = new Map()
  Object.entries(entry.value).filter(([k]) => k !== field).forEach(([k, v]) => flatten(v, k, own))
  own.forEach((cell, path) => { if (cell.text === entry.name) own.delete(path) })
  const children = field === null ? [] : (entry.value[field] as Record<string, unknown>[]).map((record) => {
    const flat: Flat = new Map()
    flatten(record, '', flat)
    return flat
  })
  return { key: entry.key, entry: entry.name, own, children }
}

const EMPTY: ComparisonCell = { text: '', number: null }

const present = (cell: ComparisonCell): boolean => cell.text !== ''

const compareCells = (a: ComparisonCell, b: ComparisonCell): number =>
  a.number !== null && b.number !== null ? a.number - b.number : a.text.localeCompare(b.text)

const byEntry = (a: ComparisonRow, b: ComparisonRow): number => a.entry.localeCompare(b.entry)

function withFirstChild(row: ComparisonRow): ComparisonRow {
  const [first, ...rest] = row.children
  if (!first) return row
  return { ...row, cells: row.cells.map((cell, i) => (present(cell) ? cell : first.cells[i])), children: rest }
}

// A row's value in a column: its own, or else the best of its children's,
// the highest when the order is descending and the lowest when ascending.
function getSortCell(row: ComparisonRow, at: number, direction: number): ComparisonCell {
  if (present(row.cells[at])) return row.cells[at]
  const values = row.children.map((c) => c.cells[at]).filter(present)
  return values.reduce<ComparisonCell>((best, cell) => (!present(best) || direction * compareCells(cell, best) < 0 ? cell : best), EMPTY)
}

// The entries as rows, each with a row under it for every record of its list,
// under the fields any of them has: the entries' own first, then their
// records', in the order they first appear; a field both have is one column,
// and one none of them sets is none. Rows go by entry name unless sorted by a
// column, by their own value in it or else their children's best, those
// without one last and equal ones by entry name; children go by the column
// too, those without a value last, and keep their order otherwise. The first
// child is drawn on its entry's row, the entry's own value winning a column
// both set.
export function getComparison(entries: ComparisonEntry[], sort: ComparisonSort = { column: null, descending: false }): Comparison {
  const flats = entries.map(getFlatEntry)
  const columns = [...new Set([...flats.flatMap((f) => [...f.own.keys()]), ...flats.flatMap((f) => f.children.flatMap((c) => [...c.keys()]))])]
  const cellsOf = (flat: Flat) => columns.map((c) => flat.get(c) ?? EMPTY)
  const rows: ComparisonRow[] = flats.map(({ key, entry, own, children }) => ({
    id: key, key, entry, cells: cellsOf(own),
    children: children.map((child, i) => ({ id: `${key}:${i}`, cells: cellsOf(child) })),
  }))
  const direction = sort.descending ? -1 : 1
  const at = sort.column === null ? -1 : columns.indexOf(sort.column)
  if (at < 0) return { columns, rows: [...rows].sort((a, b) => direction * byEntry(a, b)).map(withFirstChild) }
  const byColumn = (a: ComparisonCell, b: ComparisonCell) => Number(!present(a)) - Number(!present(b)) || (present(a) && present(b) ? direction * compareCells(a, b) : 0)
  const sorted = rows
    .map((row) => ({ ...row, children: [...row.children].sort((a, b) => byColumn(a.cells[at], b.cells[at])) }))
    .sort((a, b) => byColumn(getSortCell(a, at, direction), getSortCell(b, at, direction)) || byEntry(a, b))
  return { columns, rows: sorted.map(withFirstChild) }
}
