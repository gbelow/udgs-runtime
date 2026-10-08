import { describe, expect, it } from 'vitest'
import { makeCreationDraft } from '../../factories'
import { FOCI, PRIORITIES, RaceSchema, TrainablesSchema, type CreationDraft, type Trainables } from '../../types'
import { CREATION_ATTRIBUTE, CREATION_PRIORITIES } from '../../tables'
import { buyCreationKnowledge, buyCreationLevel, buyCreationStage, setCreationConviction, setCreationLimitStress, setCreationPriority, setCreationRace } from '../commands/creation'
import { getCreatedCharacter, getCreationBalances, getCreationBuild, getCreationPool, getCreationProblems } from './creation'
import { getKnowledgeRaisePrice, getTrainableRaisePrice } from './learning'
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

// The user's ruling: karma starts at nothing and the flaws taken fund it, for
// karma abilities and talents alike.
describe('karma at creation', () => {
  const raiseDEX = buyCreationLevel('DEX', 1)

  it('cannot pay for a talent without a flaw', () => {
    expect(getCreationProblems(raiseDEX(chosen()))).not.toEqual([])
  })

  it('is funded by flaws', () => {
    const flawed = buyCreationStage('glutton', 1)(buyCreationStage('alcoholic', 1)(chosen()))
    expect(getCreationProblems(raiseDEX(flawed))).toEqual([])
  })
})

// creating.tex "Limit Stress Actions" and "Convictions": every character
// chooses a limit stress action, a temperament and a worldview.
describe('the choices the book requires', () => {
  it('keep a character from being made until they are made', () => {
    expect(getCreationProblems(makeCreationDraft())).toHaveLength(3)
    expect(getCreationProblems(chosen())).toEqual([])
  })
})
