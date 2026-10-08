import { Character, Trainable, Trainables } from '../../types'
import { emptyKnowledge } from '../rules/knowledge'
import { LearningPrice, getKnowledgeRaisePrice, getTrainableRaisePrice } from '../rules/learning'
import { getAbilityTrainingPrice } from '../rules/abilities'
import { FamilyKey, heldAbility } from '../../abilities'

// creating.tex "Gaining Experience (XP)": what is trained in play is counted
// on the trainable it is for — XP, or karma for a talent. Once the count
// reaches the price of the next level the level rises and the count starts
// again at zero. Something that cannot rise further keeps counting.
function train(t: Trainable, amount: number, price: LearningPrice | null): Trainable {
  const XP = t.XP + amount
  if (price === null || XP < price.amount) return { ...t, XP }
  return { ...t, value: t.value + 1, XP: 0 }
}

export function addTrainingXP(key: keyof Trainables, amount: number): (c: Character) => Character {
  return (c: Character) => ({
    ...c,
    trainables: { ...c.trainables, [key]: train(c.trainables[key], amount, getTrainableRaisePrice(key)(c)) },
  })
}

export function addKnowledgeXP(name: string, amount: number): (c: Character) => Character {
  return (c: Character) => ({
    ...c,
    knowledges: { ...c.knowledges, [name]: train(c.knowledges[name] ?? emptyKnowledge(name), amount, getKnowledgeRaisePrice(name)(c)) },
  })
}

// abilities.tex "Acquiring abilities": an ability is trained like any
// trainable. Training one not yet held starts it at level 0, where none of it
// is learned; it counts toward a stage only while that stage's requirements
// are met.
export function addAbilityXP(family: FamilyKey, amount: number): (c: Character) => Character {
  return (c: Character) => ({
    ...c,
    abilities: {
      ...c.abilities,
      [family]: train(c.abilities[family] ?? heldAbility(family), amount, getAbilityTrainingPrice(family)(c)),
    },
  })
}
