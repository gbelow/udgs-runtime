// What changed between two states updated immutably, found by reference: a
// value that is the same object as before is not looked into, so finding the
// change costs only as much as the change. A record is gone into key by key,
// a list that only grew sends what was added, and anything else that changed
// is sent whole.

export type Patch = {
  set?: Record<string, unknown>
  del?: string[]
  in?: Record<string, Patch>
  push?: Record<string, unknown[]>
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const grew = (before: unknown[], after: unknown[]) =>
  after.length > before.length && before.every((v, i) => v === after[i])

// The patch that turns `before` into `after`, or null when nothing changed.
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Patch | null {
  const patch: Patch = {}
  for (const key of Object.keys(after)) {
    const a = before[key]
    const b = after[key]
    if (a === b) continue
    if (b === undefined) (patch.del ??= []).push(key)
    else if (isRecord(a) && isRecord(b)) {
      const inner = diff(a, b)
      if (inner) (patch.in ??= {})[key] = inner
    } else if (Array.isArray(a) && Array.isArray(b) && grew(a, b)) {
      (patch.push ??= {})[key] = b.slice(a.length)
    } else {
      (patch.set ??= {})[key] = b
    }
  }
  for (const key of Object.keys(before)) if (!(key in after) && before[key] !== undefined) (patch.del ??= []).push(key)
  return patch.set || patch.del || patch.in || patch.push ? patch : null
}

// `before` with `patch` applied, keeping every value it did not touch the
// same object, so that what reads the state sees no change there.
export function apply(before: Record<string, unknown>, patch: Patch): Record<string, unknown> {
  const after = { ...before, ...patch.set }
  for (const [key, inner] of Object.entries(patch.in ?? {})) {
    const value = before[key]
    after[key] = apply(isRecord(value) ? value : {}, inner)
  }
  for (const [key, added] of Object.entries(patch.push ?? {})) {
    const value = before[key]
    after[key] = [...(Array.isArray(value) ? value : []), ...added]
  }
  for (const key of patch.del ?? []) delete after[key]
  return after
}
