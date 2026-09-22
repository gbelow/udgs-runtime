import { Requirement } from '../../types'
import { ABILITIES, AbilityKey } from '../../abilities'
import { SPELLS, SpellKey } from '../../spells'

// What an ability's or a spell's requirements read as on the sheet: the
// book's own words, an item per line and its alternatives joined.
export function requirementLabel(req: Requirement): string {
  const name = req.kind === 'ability' ? ABILITIES[req.name as AbilityKey].name
    : req.kind === 'spell' ? SPELLS[req.name as SpellKey].name
    : req.kind === 'trainable' ? `${req.name} ${req.level}`
    : req.kind === 'attribute' ? `${req.name} ${req.op} ${req.level}`
    : req.name
  return req.not ? `not ${name}` : name
}

export function requirementsLabel(requirements: Requirement[][]): string {
  return requirements.map((item) => item.map(requirementLabel).join(' or ')).join(' · ')
}
