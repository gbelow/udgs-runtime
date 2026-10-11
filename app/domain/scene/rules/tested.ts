import type { Delivery } from '../../types'
import type { Action, ActionRoll, Deliveries, SceneState, StrikeAction } from '../types'
import { resolveTest } from '../../play/test'
import { getTestRollTerms } from '../../character/rules/spirit'
import { sumTerms } from '../../character/rules/terms'
import { getSituationalAfflictions } from './situational'
import { resisted } from './test'
import { isTestingStrike } from './strikeDeclaration'
import { getCounterStrike } from './counter'

// The ones an action may deliver a test to, who throw their die with the
// action's own: a cast's or a held spell's target, and the target of a strike
// declared with something that leaves one (rules/strikeDeclaration.ts) — a
// counterattack's strike is rolled with the counterattack.
export function getTestedIds(root: Action): string[] {
  const strike = root.kind === 'strike' ? root : root.kind === 'counterattack' ? getCounterStrike(root, '') : null
  const testing = root.kind === 'cast' || root.kind === 'fireAgain' || (strike !== null && isTestingStrike(strike))
  return testing && root.targetId ? [root.targetId] : []
}

type TestedRow = Action['tested'][number]

// play.tex "How skills work": an instant delivery that leaves its target a
// test is tested as its action lands, with the die they threw with it, so
// what it lands — an interruption above all — is known before anything the
// action opens is offered. Their degree is turned against it (combat.tex
// "Evasion"), and one they beat lands nothing. What follows a delivery is
// tested the same way, with the same die.
function test(state: SceneState, id: string, delivery: Delivery, die: number | undefined, tested: TestedRow[]): Delivery | null {
  const then = delivery.then.flatMap((next) => test(state, id, next, die, tested) ?? [])
  const target = state.characters[id]
  if (delivery.degree !== null || !delivery.test || delivery.effect.trigger !== 'instant' || die === undefined || !target) return { ...delivery, then }
  const skillTerms = getTestRollTerms(target, delivery.test.roll, getSituationalAfflictions(state, id))
  const DLTerms = [{ label: delivery.effect.name, value: delivery.test.DL }]
  const result = resolveTest({ skill: sumTerms(skillTerms), DL: delivery.test.DL, explodes: false, scale: 'degrees', terms: { skill: skillTerms, DL: DLTerms } }, () => die)
  const roll: ActionRoll = { die: result.die, DL: result.DL, score: result.score, degree: result.degree, HOP: 0, skillTerms, DLTerms }
  tested.push({ targetId: id, name: delivery.effect.name, roll })
  const degree = resisted(result.degree)
  return degree === 'miss' ? null : { ...delivery, degree, then }
}

// The landing action with its deliveries' tests rolled.
export function withDeliveredTests<A extends Extract<Action, { kind: 'cast' | 'fireAgain' }>>(state: SceneState, action: A): A {
  if (!action.facts) return action
  const tested: TestedRow[] = []
  const facts: Deliveries = {}
  for (const [id, deliveries] of Object.entries(action.facts)) {
    const landed = deliveries.flatMap((d) => test(state, id, d, action.targetDice[id], tested) ?? [])
    if (landed.length > 0) facts[id] = landed
  }
  return { ...action, facts, tested }
}

// A strike's blow with what follows it tested; the blow itself carries no
// test of its target's (combat.tex "Defend": the defense was its test).
export function testStrikeBlow(state: SceneState, strike: StrikeAction, blow: Delivery | null): { blow: Delivery | null; tested: TestedRow[] } {
  if (!blow || !strike.targetId) return { blow, tested: [] }
  const tested: TestedRow[] = []
  return { blow: test(state, strike.targetId, blow, strike.targetDice[strike.targetId], tested), tested }
}
