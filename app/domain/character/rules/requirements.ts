import { Character, Requirement } from '../../types'
import { ABILITIES, AbilityKey } from '../../abilities'
import { SPELLS, SpellKey } from '../../spells'
import { getAGI, getSTA, getSTR } from './characteristics'

const ATTRIBUTE = { STR: getSTR, AGI: getAGI, STA: getSTA } as const

// One item of an ability's or a spell's requirements, as far as the domain
// can see it off the character alone. Trainable levels are the book's words
// (a skill, a knowledge, a conviction) with no fixed home on the character
// yet, and conditions are the table's to judge — those hold until the domain
// can read them. Gear, held spells and abilities in effect are the cast's to
// check, where the spell they serve is known.
export function holdsRequirement(c: Character, req: Requirement): boolean {
  switch (req.kind) {
    case 'ability': return c.abilities.includes(req.name) !== req.not
    case 'spell': return (req.name in c.spells) !== req.not
    case 'attribute': return compare(ATTRIBUTE[req.name as keyof typeof ATTRIBUTE]?.(c) ?? 0, req.op, req.level) !== req.not
    case 'trainable':
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
