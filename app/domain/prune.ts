// Taking characters out of a state (multiplayer-plan.md "Hidden information"),
// for every part of play that is shown to a viewer who is not told of all of
// them.

// Fields that hold a pair of characters together: a row or object that
// names an unseen one in them goes whole, rather than losing one of the two.
const TOGETHER = new Set(['members', 'pair'])

export type Hidden = ReadonlySet<string>

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// Whether a row is about an unseen character: one of its own fields names
// them, or a field that holds a pair together does.
const aboutHidden = (row: unknown, hidden: Hidden): boolean => {
  if (!isRecord(row)) return false
  return Object.entries(row).some(([key, v]) =>
    (typeof v === 'string' && hidden.has(v)) || (TOGETHER.has(key) && Array.isArray(v) && v.some((x) => typeof x === 'string' && hidden.has(x))))
}

// `value` with every unseen character taken out: a record loses their keys, a
// list their ids and the rows that are about them, a field that names one
// reads '' (nobody). What holds none comes back as the same object.
export function prune<T>(value: T, hidden: Hidden): T {
  if (Array.isArray(value)) {
    const kept = value.filter((v) => !(typeof v === 'string' && hidden.has(v)) && !aboutHidden(v, hidden)).map((v) => prune(v, hidden))
    return (kept.length === value.length && kept.every((v, i) => v === value[i]) ? value : kept) as T
  }
  if (isRecord(value)) {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      if (hidden.has(key)) { changed = true; continue }
      const next = typeof v === 'string' && hidden.has(v) ? '' : TOGETHER.has(key) ? v : prune(v, hidden)
      if (next !== v) changed = true
      out[key] = next
    }
    return (changed ? out : value) as T
  }
  return value
}

// How a field of a state is shown to a viewer, given what the viewer knows.
export type Censor<V, C> = (value: V, c: C) => V

export const keep = <V>(value: V): V => value
export const hide = <V>(empty: V) => (): V => empty

// The entries of a record the viewer is told of; the same object when all.
export function only<V>(record: Record<string, V>, shown: (id: string) => boolean): Record<string, V> {
  const kept = Object.entries(record).filter(([id]) => shown(id))
  return kept.length === Object.keys(record).length ? record : Object.fromEntries(kept)
}
