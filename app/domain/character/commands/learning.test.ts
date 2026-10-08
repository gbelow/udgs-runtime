import { describe, expect, it } from 'vitest'
import { makeCharacter } from '../../factories'
import { ABILITY_FAMILIES, FamilyKey, getFamilyStages, hasAbility } from '../../abilities'
import { TrainablesSchema, Trainables } from '../../types'
import { getTrainableRaisePrice } from '../rules/learning'
import { getAbilityTrainingPrice } from '../rules/abilities'
import { addAbilityXP, addTrainingXP } from './learning'

const TRAINABLE_KEYS = Object.keys(TrainablesSchema.shape) as (keyof Trainables)[]
const FAMILY_KEYS = Object.keys(ABILITY_FAMILIES) as FamilyKey[]

// The table's ruling: training XP is counted on the trainable, and reaching
// the next level's price raises it by one and starts the count again at zero.
describe('training a trainable', () => {
  it.each(TRAINABLE_KEYS.filter((key) => getTrainableRaisePrice(key)(makeCharacter({})) !== null))('"%s" rises by one at its price, short of it keeps the count', (key) => {
    const c = makeCharacter({})
    const { amount } = getTrainableRaisePrice(key)(c)!
    const raised = addTrainingXP(key, amount)(c)
    expect(raised.trainables[key]).toMatchObject({ value: c.trainables[key].value + 1, XP: 0 })
    if (amount > 0) {
      const short = addTrainingXP(key, amount - 1)(c)
      expect(short.trainables[key]).toMatchObject({ value: c.trainables[key].value, XP: amount - 1 })
    }
  })
})

// The table's ruling: an ability is only available once it reaches level 1;
// half trained, the character holds it at level 0 with none of it learned.
describe('training an ability', () => {
  const open = FAMILY_KEYS.filter((family) => (getAbilityTrainingPrice(family)(makeCharacter({}))?.amount ?? 0) > 0)

  it.each(open)('"%s" is not learned short of its first stage, and is at it', (family) => {
    const c = makeCharacter({})
    const { amount } = getAbilityTrainingPrice(family)(c)!
    const [first] = getFamilyStages(family)
    const short = addAbilityXP(family, amount - 1)(c)
    expect(short.abilities[family]).toMatchObject({ value: 0, XP: amount - 1 })
    expect(hasAbility(short, first)).toBe(false)
    const learned = addAbilityXP(family, 1)(short)
    expect(learned.abilities[family]).toMatchObject({ value: 1, XP: 0 })
    expect(hasAbility(learned, first)).toBe(true)
  })
})
