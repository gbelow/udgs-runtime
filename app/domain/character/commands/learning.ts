import { Character, Trainable, Trainables } from '../../types'
import { isFormalKnowledge } from '../rules/knowledge'
import { LearningPrice, getTrainableRaisePrice } from '../rules/learning'
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

// story.tex "Specific Knowledge": a learning test raises the knowledge to a
// level outright, never lowering it. A formal knowledge's name is not a
// specific knowledge's, so it raises nothing.
export function raiseSpecificKnowledge(name: string, level: number): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => {
    const held = c.specificKnowledges[name] ?? 0
    return isFormalKnowledge(name.toLowerCase()) || level <= held ? c : { ...c, specificKnowledges: { ...c.specificKnowledges, [name]: level } }
  }
}
