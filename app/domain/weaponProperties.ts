// gear.tex "Weapons Properties". A weapon attack's properties are authored as a
// comma-separated string because that is exactly how the rulebook's gear sheet
// prints them, which keeps the asset diffable against the book. The string is a
// transport format, not a working one: it is parsed once at the schema boundary
// (see WeaponAttackSchema) and the rest of the domain reads the typed result.
//
// The parse is total — every token lands in exactly one of the typed fields,
// `recognized`, or `unknown`. Nothing is silently discarded, so a mistyped
// property is distinguishable from one the rules define but this codebase has
// not implemented yet.

// gear.tex "Heavy I/II/III": "Having a higher degree of heavy allows using any
// lower degree. Having heavy I-III or similar means that heavy I is minimum,
// and normal attacks are not allowed." That is two bounds, not six spellings:
// `min` is the lowest heavy degree available and `max` the highest, with
// `min === 0` meaning the normal (non-heavy) attack is still allowed.
//
//   heavy I     -> { min: 0, max: 1 }   normal + heavy I
//   heavy III   -> { min: 0, max: 3 }   normal + heavy I..III
//   heavy I-II  -> { min: 1, max: 2 }   heavy I..II, no normal attack
//   heavy II-III-> { min: 2, max: 3 }   heavy II..III, no normal attack
export type HeavyRange = { min: number; max: number }

export type WeaponProperties = {
  heavy: HeavyRange | null
  braced: boolean
  hook: boolean
  fast: boolean
  // Properties the rulebook defines that do not yet drive an attack variant
  // here. Kept rather than dropped so `unknown` means "not a rule", not merely
  // "not implemented".
  recognized: string[]
  // Tokens matching nothing in the rulebook vocabulary — i.e. a typo in the
  // asset, or a rule added to the book that has not reached this list.
  unknown: string[]
}

const HEAVY = /^heavy (I{1,3})(?:-(I{1,3}))?$/
const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3 }

// gear.tex "STR x" (strength requirement) and "Size x" (wieldable creature
// size) are parameterized properties, so they carry a number in the token.
const PARAMETERIZED = /^(STR|size) -?\d+$/i

// The authored vocabulary: the gear.tex "Weapons Properties" proplist, plus the
// spellings its own weapon tables use for the same rules ("sweep" for Sweeping,
// "grab" on the Net row) and "smash", defined as an additional effect in
// combat.tex rather than in the property list. It is kept complete, including
// the properties promoted to typed fields above — those are matched earlier and
// never fall through to this set, but a partial list here would read as a claim
// that the missing ones are not rules.
const VOCABULARY = new Set([
  'bladed',
  'braced',
  'DEF',
  'draw',
  'fast',
  'grab',
  'grapple',
  'hook',
  'penetrating',
  'piercing',
  'precise',
  'reload',
  'shaft',
  'slow',
  'smash',
  'sweep',
  'sweeping',
  'UF',
  'vicious',
])

export const EMPTY_PROPERTIES: WeaponProperties = {
  heavy: null,
  braced: false,
  hook: false,
  fast: false,
  recognized: [],
  unknown: [],
}

export function parseWeaponProperties(raw: string): WeaponProperties {
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const props: WeaponProperties = { ...EMPTY_PROPERTIES, recognized: [], unknown: [] }

  for (const token of tokens) {
    const heavy = HEAVY.exec(token)
    if (heavy) {
      const [, lower, upper] = heavy
      // A bare degree ("heavy II") tops out there and keeps the normal attack;
      // a range ("heavy I-II") makes its lower bound the minimum and drops it.
      props.heavy = upper
        ? { min: ROMAN[lower], max: ROMAN[upper] }
        : { min: 0, max: ROMAN[lower] }
      continue
    }

    switch (token) {
      case 'braced':
        props.braced = true
        continue
      case 'hook':
        props.hook = true
        continue
      case 'fast':
        props.fast = true
        continue
    }

    if (VOCABULARY.has(token) || PARAMETERIZED.test(token)) {
      props.recognized.push(token)
      continue
    }

    props.unknown.push(token)
  }

  return props
}
