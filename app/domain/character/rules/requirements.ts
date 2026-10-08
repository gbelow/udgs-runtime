import { TrainablesSchema, type Character, type Requirement, type Trainables } from '../../types'
import { ABILITIES, AbilityKey, hasAbility } from '../../abilities'
import { SPELLS, SpellKey } from '../../spells'
import { TEMPERAMENT_CONVICTIONS, WORLDVIEW_CONVICTIONS, knowledges_list } from '../../lists'
import { getAGI, getSTA, getSTR } from './characteristics'

const ATTRIBUTE = { STR: getSTR, AGI: getAGI, STA: getSTA } as const

// creating.tex "Convictions": a temperament is held on the first conviction
// slot, a worldview on the second; null for a name that is neither.
export type ConvictionSlot = 'conviction1' | 'conviction2'
const named = (options: Record<string, { name: string }>, name: string): boolean => Object.values(options).some((o) => o.name === name)

export function getConvictionSlot(name: string): ConvictionSlot | null {
  return named(TEMPERAMENT_CONVICTIONS, name) ? 'conviction1' : named(WORLDVIEW_CONVICTIONS, name) ? 'conviction2' : null
}

// The level of a conviction the character has adopted; null when it has not.
export function getConvictionLevel(c: Character, name: string): number | null {
  const slot = getConvictionSlot(name)
  return slot && c.trainables[slot].name === name ? c.trainables[slot].value : null
}

// Where a trainable a requirement names is kept: a conviction on its slot, a
// knowledge by its name, anything else on the trainable that carries the
// name. abilities.tex names the climb and swim skills "Climbing" and
// "Swimming". Null for a name the domain does not hold.
export type RequiredTrainable =
  | { kind: 'conviction'; slot: ConvictionSlot }
  | { kind: 'knowledge'; name: string }
  | { kind: 'trainable'; key: keyof Trainables }

const SKILL_ALIASES: Record<string, keyof Trainables> = { climbing: 'climb', swimming: 'swim' }
const TRAINABLE_BY_NAME = new Map(Object.entries(TrainablesSchema.parse({})).map(([key, t]) => [t.name.toLowerCase(), key as keyof Trainables]))
const KNOWLEDGES = new Set(knowledges_list)

export function getRequiredTrainable(name: string): RequiredTrainable | null {
  const slot = getConvictionSlot(name)
  if (slot) return { kind: 'conviction', slot }
  const lower = name.toLowerCase()
  if (KNOWLEDGES.has(lower)) return { kind: 'knowledge', name: lower }
  const key = SKILL_ALIASES[lower] ?? TRAINABLE_BY_NAME.get(lower)
  return key ? { kind: 'trainable', key } : null
}

// The level the character has trained in what a requirement names: null for
// a conviction it has not adopted, undefined for a name the domain does not
// hold.
export function getRequiredLevel(c: Character, name: string): number | null | undefined {
  const held = getRequiredTrainable(name)
  switch (held?.kind) {
    case 'conviction': return getConvictionLevel(c, name)
    case 'knowledge': return c.knowledges[held.name]?.value ?? 0
    case 'trainable': return c.trainables[held.key].value
    default: return undefined
  }
}

// One item of an ability's or a spell's requirements, as far as the domain
// can see it off the character alone. A trainable is read at the level
// trained, a conviction only once adopted. Conditions are the table's to
// judge — those hold until the domain can read them. Gear, held spells and
// abilities in effect are the cast's to check, where the spell they serve is
// known.
export function holdsRequirement(c: Character, req: Requirement): boolean {
  switch (req.kind) {
    case 'ability': return hasAbility(c, req.name) !== req.not
    case 'spell': return (req.name in c.spells) !== req.not
    case 'attribute': return compare(ATTRIBUTE[req.name as keyof typeof ATTRIBUTE]?.(c) ?? 0, req.op, req.level) !== req.not
    case 'trainable': {
      const level = getRequiredLevel(c, req.name)
      return level === undefined || compare(level ?? -1, req.op, req.level) !== req.not
    }
    case 'gear':
    case 'condition':
    case 'sustaining':
    case 'active':
      return true
  }
}

function compare(value: number, op: Requirement['op'], threshold: number): boolean {
  switch (op) {
    case '>': return value > threshold
    case '<': return value < threshold
    case '>=': return value >= threshold
    case '<=': return value <= threshold
  }
}

// What an ability's or a spell's requirements read as: the book's own words,
// an item per line and its alternatives joined.
export function requirementLabel(req: Requirement): string {
  const name = req.kind === 'ability' ? ABILITIES[req.name as AbilityKey].name
    : req.kind === 'spell' ? SPELLS[req.name as SpellKey].name
    : req.kind === 'sustaining' ? `${SPELLS[req.name as SpellKey].name} held`
    : req.kind === 'active' ? `${ABILITIES[req.name as AbilityKey].name} on`
    : req.kind === 'trainable' ? `${req.name} ${req.level}`
    : req.kind === 'attribute' ? `${req.name} ${req.op} ${req.level}`
    : req.name
  return req.not ? `not ${name}` : name
}

export function requirementsLabel(requirements: Requirement[][]): string {
  return requirements.map((item) => item.map(requirementLabel).join(' or ')).join(' · ')
}

// The items of a list of requirements the character falls short of, as the
// book words them.
export function getUnmetRequirements(c: Character, requirements: Requirement[][]): string[] {
  return requirements.filter((item) => !item.some((alt) => holdsRequirement(c, alt))).map((item) => item.map(requirementLabel).join(' or '))
}
