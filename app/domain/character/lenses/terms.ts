// Shared read-side projection for breakdowns.
//
// Each derived getter is computed from its `*Terms` array via `sumTerms`, so
// the displayed value and the per-term tooltip breakdown can never drift.
// `Term` is a read projection (not persisted/ingested), so it lives in the
// lenses layer rather than in types.ts. Shared here so both `skills.ts` and
// `characteristics.ts` can use it without importing each other.
export type Term = { label: string; value: number }

export const sumTerms = (terms: Term[]): number => terms.reduce((s, t) => s + t.value, 0)

// Everything a breakdown can show — the labels, the numbers and their order.
// Used to gate a re-render on the breakdown itself rather than on its sum, which
// two offsetting modifiers or a renamed term leave unmoved.
export const termsDigest = (terms: Term[]): string =>
  terms.map((t) => `${t.label}:${t.value}`).join('|')

// What the sheet reports as a value being "currently modified": the terms that
// come and go with the character's state rather than with its build.
const SITUATIONAL = new Set(['affliction', 'immobile', 'gear', 'abilities'])
export const situationalModifier = (terms: Term[]): number =>
  sumTerms(terms.filter((t) => SITUATIONAL.has(t.label)))

// True when an affliction-sourced term is actively reducing the value.
const HARM = new Set(['affliction', 'immobile'])
export const isAfflicted = (terms: Term[]): boolean =>
  terms.some((t) => HARM.has(t.label) && t.value < 0)

export type TermsView = { modifier: number; afflicted: boolean }
export const termsView = (terms: Term[]): TermsView =>
  ({ modifier: situationalModifier(terms), afflicted: isAfflicted(terms) })
