import { describe, expect, it } from 'vitest'
import { makeCreationDraft } from '../../factories'
import { FOCI, PRIORITIES, RaceSchema, TrainablesSchema, type CreationDraft, type Trainables } from '../../types'
import { CREATION_ATTRIBUTE, CREATION_PRIORITIES } from '../../tables'
import { buyCreationKnowledge, buyCreationLevel, buyCreationStage, setCreationConviction, setCreationLimitStress, setCreationPriority, setCreationRace, setCreationSpell, claimCreationSpell } from '../commands/creation'
import { getCreatedCharacter, getCreationAbilityRaises, getCreationBalances, getCreationBuild, getCreationCharges, getCreationPool, getCreationProblems, getCreationSpellRaises } from './creation'
import { ABILITY_FAMILIES, getAbilityLevel, getFamilyStages, type FamilyKey } from '../../abilities'
import { SPELL_LEARN_XP, getKnowledgeRaisePrice, getTrainableRaisePrice } from './learning'
import { SPELLS, SPELL_KEYS, type SpellKey } from '../../spells'
import { knowledges_list } from '../../lists'

const TRAINABLE_KEYS = Object.keys(TrainablesSchema.shape) as (keyof Trainables)[]

// A draft with the choices the book requires made, so only its budget can
// stand in its way.
const chosen = (): CreationDraft =>
  setCreationLimitStress('coward')(setCreationConviction('conviction2', 'Stoicism')(setCreationConviction('conviction1', 'Fatalism')(makeCreationDraft())))

const spent = (d: CreationDraft): number => Object.values(getCreationBalances(d)).reduce((sum, b) => sum + b.spent, 0)

// creating.tex "Character Creation", Steps 4–7: creation XP buys levels at
// the prices "Talent and Learning" gives for training them, so each level
// bought costs what training it would.
describe('a level bought at creation costs what training it costs', () => {
  it.each(TRAINABLE_KEYS.filter((key) => getCreationPool(key) !== null))('"%s"', (key) => {
    let d = makeCreationDraft()
    for (let level = 0; level < 3; level++) {
      const price = getTrainableRaisePrice(key)(getCreationBuild(d))
      const raised = buyCreationLevel(key, 1)(d)
      if (price === null) {
        expect(raised).toBe(d)
        return
      }
      expect(spent(raised) - spent(d)).toBe(price.amount)
      d = raised
    }
  })

  it.each(knowledges_list)('knowledge "%s"', (name) => {
    let d = makeCreationDraft()
    for (let level = 0; level < 3; level++) {
      const raised = buyCreationKnowledge(name, 1)(d)
      expect(spent(raised) - spent(d)).toBe(getKnowledgeRaisePrice(name)(getCreationBuild(d)).amount)
      d = raised
    }
  })
})

// creating.tex "Character Creation", Step 2: each focus gets its own
// priority, so every priority is held by exactly one focus.
describe('priorities stay one per focus', () => {
  it.each(FOCI.flatMap((focus) => PRIORITIES.map((priority) => [focus, priority] as const)))('%s to %s', (focus, priority) => {
    const d = setCreationPriority(focus, priority)(makeCreationDraft())
    expect(d.priorities[focus]).toBe(priority)
    expect(FOCI.map((f) => d.priorities[f]).sort()).toEqual([...PRIORITIES])
  })
})

// The user's ruling on creating.tex Step 1 ("Add the attribute bonuses after
// step 4"): attributes start at 8, are raised only with XP priced from 8, and
// the race's bonuses go on top at the end; its talent bonuses count from the
// start.
describe('the race at creation', () => {
  const race = RaceSchema.parse({ name: 'Strong', bonuses: { STR: 4, AGI: -1, CON: 1 } })

  it.each(PRIORITIES)('with CON at %s, the race adds its attributes last and its talents first', (priority) => {
    const d = setCreationPriority('CON', priority)(setCreationRace(race)(makeCreationDraft()))
    const created = getCreatedCharacter(d)
    expect(created.trainables.STR.value).toBe(CREATION_ATTRIBUTE + 4)
    expect(created.trainables.AGI.value).toBe(CREATION_ATTRIBUTE - 1)
    expect(created.trainables.CON.value).toBe(1 + CREATION_PRIORITIES[priority].talent)
  })

  it('does not change what an attribute costs', () => {
    const buy = (d: CreationDraft) => buyCreationLevel('STR', 1)(buyCreationLevel('STR', 1)(d))
    const plain = buy(makeCreationDraft())
    const raced = buy(setCreationRace(RaceSchema.parse({ name: 'Strong', bonuses: { STR: 4 } }))(makeCreationDraft()))
    expect(getCreationBalances(raced).CON.spent).toBe(getCreationBalances(plain).CON.spent)
  })
})

// The user's ruling: changing race changes only what the race sets and the
// prices that follow from it; a stage bought that the new race gives is
// refunded, and charged again if the race is changed back.
describe('changing race', () => {
  const families = (Object.keys(ABILITY_FAMILIES) as FamilyKey[]).filter((family) => family in getCreationAbilityRaises(chosen()))

  it('keeps the name, the choices and everything bought', () => {
    const d = buyCreationStage(families[0], 1)(buyCreationKnowledge('medicine', 1)(buyCreationLevel('strike', 1)(chosen())))
    const named = { ...d, character: { ...d.character, name: 'Ann' } }
    const raced = setCreationRace(RaceSchema.parse({ name: 'Strong', bonuses: { CON: 1 } }))(named)
    expect({ ...raced, race: null }).toEqual(named)
  })

  it.each(families)('refunds "%s" when the race gives it', (family) => {
    const bought = buyCreationStage(family, 1)(chosen())
    const charged = (d: CreationDraft) => getCreationCharges(d).filter((c) => c.key === family)
    const giving = setCreationRace(RaceSchema.parse({ name: 'Giving', abilities: [getFamilyStages(family)[0]] }))(bought)
    expect(charged(giving)).toEqual([])
    expect(getAbilityLevel(getCreationBuild(giving), family)).toBe(1)
    expect(setCreationRace(null)(giving)).toEqual(bought)
  })
})

// The user's ruling: a spell costs the 6 XP of spells.tex "Learning spells"
// by any method, from the INT XP; given back, it is refunded.
describe('a spell chosen at creation', () => {
  const raises = getCreationSpellRaises(chosen())
  const offered = (Object.keys(raises) as SpellKey[]).filter((key) => raises[key]?.intuitive)

  it.each(offered)('"%s" costs 6 INT XP and is refunded', (key) => {
    const d = chosen()
    const learned = setCreationSpell(key, 'intuitive')(d)
    expect(getCreationBalances(learned).INT.spent - getCreationBalances(d).INT.spent).toBe(SPELL_LEARN_XP)
    expect(key in getCreatedCharacter(learned).spells).toBe(true)
    expect(setCreationSpell(key, null)(learned)).toEqual(d)
  })
})

// abilities.tex "Magic Theory": "Learns two spells for which the character
// has knowledge" — two, free, and only where every knowledge the spell names
// is held at its level.
describe('the spells Magic Theory teaches', () => {
  const theorist = (): CreationDraft => {
    let d = buyCreationKnowledge('linguistics', 1)(buyCreationKnowledge('linguistics', 1)(chosen()))
    for (let i = 0; i < 3; i++) d = buyCreationKnowledge('alchemy', 1)(buyCreationKnowledge('animancy', 1)(d))
    return buyCreationStage('magic-theory', 1)(buyCreationStage('literacy', 1)(d))
  }

  it('are two, cost nothing and need their knowledge', () => {
    let d = theorist()
    const charges = getCreationCharges(d)
    const claimed: SpellKey[] = []
    for (const key of SPELL_KEYS) {
      const next = claimCreationSpell(key)(d)
      if (next === d) continue
      claimed.push(key)
      d = next
    }
    expect(claimed).toHaveLength(2)
    expect(getCreationCharges(d)).toEqual(charges)
    for (const key of claimed) {
      expect(getCreatedCharacter(d).spells[key]?.method).toBe('wizard')
      for (const k of SPELLS[key].knowledge) expect(getCreatedCharacter(d).knowledges[k.name]?.value ?? 0).toBeGreaterThanOrEqual(k.level)
    }
  })
})

const problemsBesidesUnspent = (d: CreationDraft): string[] => getCreationProblems(d).filter((problem) => !problem.includes('left to spend'))

// The user's ruling: karma starts at nothing and the flaws taken fund it, for
// karma abilities and talents alike.
describe('karma at creation', () => {
  const raiseDEX = buyCreationLevel('DEX', 1)

  it('cannot pay for a talent without a flaw', () => {
    expect(problemsBesidesUnspent(raiseDEX(chosen()))).not.toEqual([])
  })

  it('is funded by flaws', () => {
    const flawed = buyCreationStage('glutton', 1)(buyCreationStage('alcoholic', 1)(chosen()))
    expect(problemsBesidesUnspent(raiseDEX(flawed))).toEqual([])
  })
})

// creating.tex "Limit Stress Actions" and "Convictions": every character
// chooses a limit stress action, a temperament and a worldview.
describe('the choices the book requires', () => {
  it('keep a character from being made until they are made', () => {
    expect(problemsBesidesUnspent(makeCreationDraft())).toHaveLength(3)
    expect(problemsBesidesUnspent(chosen())).toEqual([])
  })
})

// creating.tex "Character Creation", Steps 4–7: each focus gives XP "to
// distribute", so an XP pool left unspent keeps the character from being made.
describe('XP left to spend', () => {
  it.each(['CON', 'SPI', 'INT', 'DEX'] as const)('%s keeps a character from being made', (pool) => {
    expect(getCreationProblems(chosen()).some((problem) => problem.startsWith(`${pool} has`))).toBe(true)
  })
})
