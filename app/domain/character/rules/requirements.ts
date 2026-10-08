import { Character, Requirement } from '../../types'
import { ABILITIES, AbilityKey, hasAbility } from '../../abilities'
import { SPELLS, SpellKey } from '../../spells'
import { TEMPERAMENT_CONVICTIONS, WORLDVIEW_CONVICTIONS } from '../../lists'
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

// One item of an ability's or a spell's requirements, as far as the domain
// can see it off the character alone. A conviction is held at a level only
// once adopted. Other trainable levels are the book's words (a skill, a
// knowledge) with no fixed home on the character yet, and conditions are the
// table's to judge — those hold until the domain can read them. Gear, held
// spells and abilities in effect are the cast's to check, where the spell
// they serve is known.
export function holdsRequirement(c: Character, req: Requirement): boolean {
  switch (req.kind) {
    case 'ability': return hasAbility(c, req.name) !== req.not
    case 'spell': return (req.name in c.spells) !== req.not
    case 'attribute': return compare(ATTRIBUTE[req.name as keyof typeof ATTRIBUTE]?.(c) ?? 0, req.op, req.level) !== req.not
    case 'trainable': return getConvictionSlot(req.name) === null || compare(getConvictionLevel(c, req.name) ?? -1, req.op, req.level) !== req.not
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
