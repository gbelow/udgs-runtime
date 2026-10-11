import type { Delivery } from '../../types'
import type { Action, ActionRoll, Deliveries, SceneState } from '../types'
import { resolveTest } from '../../play/test'
import { getTestRollTerms } from '../../character/rules/spirit'
import { sumTerms } from '../../character/rules/terms'
import { getSituationalAfflictions } from './situational'
import { resisted } from './test'

// The ones an action may deliver a test to, who throw their die with the
// action's own: a cast's or a held spell's target.
export function getTestedIds(root: Action): string[] {
  return (root.kind === 'cast' || root.kind === 'fireAgain') && root.targetId ? [root.targetId] : []
}

type Tested = { delivery: Delivery | null; roll: ActionRoll | null }

// play.tex "How skills work": an instant delivery that leaves its target a
// test is tested as its action lands, with the die they threw with it, so
// what it lands — an interruption above all — is known before anything the
// action opens is offered. Their degree is turned against it (combat.tex
// "Evasion"), and one they beat lands nothing.
function test(state: SceneState, id: string, delivery: Delivery, die: number | undefined): Tested {
  const target = state.characters[id]
  if (delivery.degree !== null || !delivery.test || delivery.effect.trigger !== 'instant' || die === undefined || !target) return { delivery, roll: null }
  const skillTerms = getTestRollTerms(target, delivery.test.roll, getSituationalAfflictions(state, id))
  const DLTerms = [{ label: delivery.effect.name, value: delivery.test.DL }]
  const result = resolveTest({ skill: sumTerms(skillTerms), DL: delivery.test.DL, explodes: false, scale: 'degrees', terms: { skill: skillTerms, DL: DLTerms } }, () => die)
  const roll: ActionRoll = { die: result.die, DL: result.DL, score: result.score, degree: result.degree, HOP: 0, skillTerms, DLTerms }
  const degree = resisted(result.degree)
  return { delivery: degree === 'miss' ? null : { ...delivery, degree }, roll }
}

function testAll(state: SceneState, action: Action, facts: Deliveries): { facts: Deliveries; tested: Action['tested'] } {
  const tested: Action['tested'] = []
  const out: Deliveries = {}
  for (const [id, deliveries] of Object.entries(facts)) {
    const landed = deliveries.flatMap((d) => {
      const { delivery, roll } = test(state, id, d, action.targetDice[id])
      if (roll) tested.push({ targetId: id, name: d.effect.name, roll })
      return delivery ? [delivery] : []
    })
    if (landed.length > 0) out[id] = landed
  }
  return { facts: out, tested }
}

// The landing action with its deliveries' tests rolled.
export function withDeliveredTests<A extends Extract<Action, { kind: 'cast' | 'fireAgain' }>>(state: SceneState, action: A): A {
  return action.facts ? { ...action, ...testAll(state, action, action.facts) } : action
}
