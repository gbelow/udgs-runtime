import { Character, Requirement } from '../../types'
import { ABILITIES, AbilityKey } from '../../abilities'
import { getAGI, getSTA, getSTR } from './characteristics'

const ATTRIBUTE = { STR: getSTR, AGI: getAGI, STA: getSTA } as const

// One item of an ability's requirements, as far as the domain can see it.
// Trainable levels are the book's words (a skill, a knowledge, a conviction)
// with no fixed home on the character yet, and gear and conditions are the
// table's to judge — those hold until the domain can read them.
function holdsRequirement(c: Character, req: Requirement): boolean {
  switch (req.kind) {
    case 'ability': return c.abilities.includes(req.name) !== req.not
    case 'spell': return (req.name in c.spells) !== req.not
    case 'attribute': return compare(ATTRIBUTE[req.name as keyof typeof ATTRIBUTE]?.(c) ?? 0, req.op, req.level) !== req.not
    case 'trainable':
    case 'gear':
    case 'condition':
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

// abilities.tex "Acquiring abilities": "It is not possible to acquire an
// ability unless the requirements are met" and each is acquired once. Every
// listed item is needed and any alternative within an item satisfies it.
export function canLearnAbility(key: AbilityKey): (c: Character) => boolean {
  return (c: Character) =>
    !c.abilities.includes(key) &&
    ABILITIES[key].requires.every((req) => c.abilities.includes(req)) &&
    ABILITIES[key].requirements.every((item) => item.some((alt) => holdsRequirement(c, alt)))
}

// creating.tex "Talent and Learning": the XP price doubles for every level
// the training level sits above the character's talent. A karma-priced
// ability costs no XP.
export function getAbilityXPCost(key: AbilityKey): (c: Character) => number {
  return (c: Character) => {
    const { XPcost, talent } = ABILITIES[key]
    const shortfall = talent.reduce((worst, t) => Math.max(worst, t.level - c.trainables[t.property].value), 0)
    return XPcost * 2 ** shortfall
  }
}
