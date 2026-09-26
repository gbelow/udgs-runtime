import { describe, it, expect } from 'vitest'
import { ABILITIES, ABILITY_KEYS, AbilityKey } from './abilities'
import { SPELL_KEYS } from './spells'
import { applyTrigger, forgetAbility, learnAbility, toggleAbility, useAbility } from './character/commands'
import { nextRound } from './combat/commands/nextRound'
import { getDrain, getUpkeep } from './character/rules/effects'
import { makeCampaignCharacter, makeCharacter } from './factories'
import { AbilityFamilySchema } from './types'
import catalog from '../assets/abilities.json'
import type { CampaignCharacter, Character, Requirement } from './types'

// The catalog crosses from untyped JSON into the schema here: every entry
// must carry every field it claims, so an edit that drops or misnames one
// fails instead of silently taking a default.
describe('abilities.json', () => {
  it.each(Object.entries(catalog as Record<string, unknown>))('%s parses losslessly — nothing stripped, nothing defaulted', (key, raw) => {
    expect(AbilityFamilySchema.parse(raw), key).toEqual(raw)
  })
})

// abilities.tex "Acquiring abilities": a multi-level ability "receives an I,
// II, III next to its name, indicating each level", so every stage of a
// family but its first stands on the stage before it.
describe('ability catalog — stages', () => {
  const familyStages = (family: string) =>
    ABILITY_KEYS.filter((k) => ABILITIES[k].family === family).sort((a, b) => ABILITIES[a].stage - ABILITIES[b].stage)
  const staged = ABILITY_KEYS.filter((key) => familyStages(ABILITIES[key].family)[0] !== key)

  it.each(staged)('"%s" requires the previous stage of its family', (key) => {
    const stages = familyStages(ABILITIES[key].family)
    const previous = stages[stages.indexOf(key) - 1]
    expect(ABILITIES[key].requires).toContain(previous)
  })

  it.each(ABILITY_KEYS)('every requirement of "%s" is a catalog key', (key) => {
    for (const req of ABILITIES[key].requires) expect(ABILITY_KEYS).toContain(req)
    for (const alt of ABILITIES[key].requirements.flat()) {
      if (alt.kind === 'ability') expect(ABILITY_KEYS).toContain(alt.name)
      if (alt.kind === 'spell') expect(SPELL_KEYS).toContain(alt.name)
    }
  })
})

function holdsRequirements(c: Character): boolean {
  return c.abilities.every((key) =>
    ABILITIES[key as AbilityKey].requires.every((req) => c.abilities.includes(req)),
  )
}

// The chain of stages up to and including `key`, in learning order.
function chain(key: AbilityKey): AbilityKey[] {
  const { requires } = ABILITIES[key]
  return [...requires.flatMap((req) => chain(req as AbilityKey)), key]
}

const ENFORCED: Requirement['kind'][] = ['ability', 'spell', 'attribute']

// A value on the far side of an attribute threshold: past it when `meet`,
// short of it otherwise.
function attributeValue(req: Requirement, meet: boolean): number {
  const above = req.op === '>' || req.op === '>='
  const past = req.op === '>' || req.op === '<' ? 1 : 0
  return above === meet ? req.level + past : req.level - past
}

// Grants or withholds one requirement item on a character; nothing the
// domain cannot read (trainables, gear, conditions) is touched.
function grant(c: Character, req: Requirement, meet: boolean): Character {
  const present = meet !== req.not
  switch (req.kind) {
    case 'ability':
      return present
        ? { ...c, abilities: [...new Set([...c.abilities, ...chain(req.name as AbilityKey)])] }
        : { ...c, abilities: c.abilities.filter((a) => a !== req.name) }
    case 'spell': {
      const spells = { ...c.spells }
      if (present) spells[req.name] = { method: 'intuitive', practice: 0 }
      else delete spells[req.name]
      return { ...c, spells }
    }
    case 'attribute': {
      const name = req.name as 'STR' | 'AGI' | 'STA'
      return { ...c, trainables: { ...c.trainables, [name]: { ...c.trainables[name], value: attributeValue(req, present) } } }
    }
    default:
      return c
  }
}

// Everything the domain can see of an ability's requirements, met outright.
function ready(key: AbilityKey): Character {
  const { requires, requirements } = ABILITIES[key]
  const chained = requires.reduce<Character>((c, k) => grant(c, { kind: 'ability', name: k, level: 0, op: '>=', not: false }, true), makeCharacter({}))
  return requirements.reduce<Character>((c, item) => grant(c, item[0], true), chained)
}

// abilities.tex "Acquiring abilities": "It is not possible to acquire an
// ability unless the requirements are met" and "Abilities can only be
// acquired once".
describe('learning abilities', () => {
  it.each(ABILITY_KEYS)('"%s" is learnable once its requirements are met, and only once', (key) => {
    const once = learnAbility(key)(ready(key))
    expect(once.abilities).toContain(key)
    expect(learnAbility(key)(once)).toBe(once)
  })

  // Every item whose alternatives the domain can all read is necessary:
  // withholding it, and it alone, closes the ability.
  const gated: [AbilityKey, string, Requirement[]][] = ABILITY_KEYS.flatMap((key) => [
    ...ABILITIES[key].requires.map((req): [AbilityKey, string, Requirement[]] =>
      [key, `ability ${req}`, [{ kind: 'ability', name: req, level: 0, op: '>=', not: false }]]),
    ...ABILITIES[key].requirements
      .filter((item) => item.every((alt) => ENFORCED.includes(alt.kind)))
      .map((item): [AbilityKey, string, Requirement[]] =>
        [key, item.map((alt) => `${alt.not ? 'not ' : ''}${alt.kind} ${alt.name}`).join(' or '), item]),
  ])

  it.each(gated)('"%s" is not learnable without %s', (key, _label, item) => {
    const short = item.reduce<Character>((c, alt) => grant(c, alt, false), ready(key))
    expect(learnAbility(key)(short)).toBe(short)
  })

  it.each(ABILITY_KEYS)('forgetting any link of the chain to "%s" leaves the requirements met', (key) => {
    const full = chain(key).reduce<Character>((c, k) => learnAbility(k)(c), ready(key))
    expect(holdsRequirements(full)).toBe(true)
    for (const link of chain(key)) {
      const after = forgetAbility(link)(full)
      expect(after.abilities).not.toContain(link)
      expect(holdsRequirements(after)).toBe(true)
    }
  })
})

// abilities.tex "Synesthesia": "+1 STA per turn" — an ability held on is paid
// for at every round change, and one switched off costs nothing.
describe('toggle abilities', () => {
  const toggles = ABILITY_KEYS.filter((key) => ABILITIES[key].activation === 'toggle')

  it.each(toggles)('"%s" charges its upkeep at the round change only while on', (key) => {
    const learned = chain(key).reduce<Character>((c, k) => learnAbility(k)(c), makeCampaignCharacter({ ...ready(key), resources: { STA: 10, AP: 8 } }))
    const off = learned as CampaignCharacter
    const on = toggleAbility(key)(off) as CampaignCharacter
    const upkeep = getUpkeep(on)

    const endRound = applyTrigger('end_round')
    expect(endRound(off).resources).toEqual(off.resources)
    expect(endRound(on).resources.STA).toBe(on.resources.STA - upkeep.STA)
    expect(endRound(on).resources.AP).toBe(on.resources.AP - upkeep.AP)
    expect(toggleAbility(key)(on)).toEqual(off)
  })
})

// An ability's `cost` is the price of a use and its effects' `trigger` says
// when each falls due: `instant` at the use, `end_round` at the round change
// (types.ts TriggerSchema). A fired ability used to be forgotten the moment
// its price was paid, so a cost it listed for the round change was never
// charged.
describe('used abilities', () => {
  const actives = ABILITY_KEYS.filter((key) => ABILITIES[key].activation === 'active')

  it.each(actives)('"%s" pays its price and instant drain at the use and its round-change drain once, at the next round', (key) => {
    const learned = chain(key).reduce<Character>((c, k) => learnAbility(k)(c), makeCampaignCharacter({ ...ready(key), resources: { STA: 20, AP: 8 } })) as CampaignCharacter
    const { cost, effect } = ABILITIES[key]
    const drain = getDrain(effect, 'instant')
    const upkeep = getDrain(effect, 'end_round')

    const used = useAbility(key)(learned) as CampaignCharacter
    expect(used.resources.STA).toBe(learned.resources.STA - cost.STA - drain.STA)
    expect(used.resources.AP).toBe(learned.resources.AP - cost.AP - drain.AP)
    expect(used.resources.exhaustion).toBe(learned.resources.exhaustion + cost.exhaustion + drain.exhaustion)

    const round = (c: CampaignCharacter) => nextRound({ characters: { c }, activeCharacterId: 'c', round: 0, inTurnCharacter: 'c', actions: [], stack: [], history: [], board: null, grapples: [], floor: [] }).characters.c
    const after = round(used)
    expect(after.resources.STA).toBe(used.resources.STA - upkeep.STA)
    expect(after.resources.exhaustion).toBe(used.resources.exhaustion + upkeep.exhaustion)
    expect(after.injuries.injuryLevel).toBe(used.injuries.injuryLevel + upkeep.IL)

    const later = round(after)
    expect(later.resources.STA).toBe(after.resources.STA)
    expect(later.resources.exhaustion).toBe(after.resources.exhaustion)
    expect(later.injuries.injuryLevel).toBe(after.injuries.injuryLevel)
  })
})
