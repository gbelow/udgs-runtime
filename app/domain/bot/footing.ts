import type { Character, Coord } from '../types'
import type { Degree, MoveAction, SceneState } from '../scene/types'
import { SWIM_STRUGGLE_AP } from '../tables'
import { sumTerms } from '../character/rules/terms'
import { getTestMode } from '../character/rules/effects'
import { getBalanceTerms } from '../character/rules/skills'
import { getDegree } from '../play/test'
import { getRootTest } from '../scene/rules/attack'
import { getDifficultSteps, isSafeOnDifficultTerrain } from '../scene/rules/move'
import { getClimbDegree, isTrivialClimb } from '../scene/rules/board/cliff'
import { getMoveHeld, getHeldRoll } from '../scene/rules/heldRoll'
import { getSwimTestTerms, getWaterOf } from '../scene/rules/swim'
import { getFallDL } from '../scene/rules/fall'
import { getSensoryTermsHere } from '../scene/rules/detection'
import { outcomeOf } from '../scene/rules/damage'
import { getFallDeliveries } from '../character/rules/fall'
import { coordKey } from '../scene/rules/board/geometry'
import { getFaceOdds } from './odds'
import type { SpecWeights } from './cost'

// spec "Movement": how the bot reads ground a skill is needed to cross, before
// the test is rolled: how likely each degree is, the chance a walk ends where
// it was walked to, the pace a swimmer keeps and the harm of a fall. A test
// held this round is known. Nothing here decides.

const NO_ODDS = (): Record<Degree, number> => ({ miss: 0, graze: 0, hit: 0, critical: 0 })

// The chance of each degree of a test at `skill` against `DL`, rolled as the character rolls.
export function getDegreeOdds(c: Character, skill: number, DL: number): Record<Degree, number> {
  const odds = NO_ODDS()
  getFaceOdds(getTestMode(c)).forEach((p, face) => { odds[getDegree(face + skill, DL)] += p })
  return odds
}

// spec "Movement", p(no fall): the chance that the move along `path` is not
// cut short by a fall. A climb falls on a miss (combat.tex "Climbing"); a
// walk through difficult terrain falls where the balance test does not clear
// its movement against the worst of the cells it comes down on, each held
// against the one score (combat.tex "Balance").
export function getNoFall(state: SceneState, action: MoveAction, path: Coord[]): number {
  const c = state.characters[action.actorId]
  if (!c || path.length === 0) return 1
  const move: MoveAction = { ...action, path }
  if (move.movement === 'climb') {
    if (isTrivialClimb(state, move)) return 1
    const known = getClimbDegree(state, move)
    if (known !== null) return known === 'miss' ? 0 : 1
    const test = getRootTest(state, move)
    return test ? 1 - getDegreeOdds(c, test.skill, test.DL).miss : 1
  }
  const steps = getDifficultSteps(state, move)
  if (steps.length === 0) return 1
  const worst = Math.max(...steps.map((s) => s.DL))
  const clears = (score: number) => isSafeOnDifficultTerrain(move.movement, getDegree(score, worst))
  const held = getMoveHeld(state, move, 'balance')
  if (held) return clears(held.score) ? 1 : 0
  const skill = sumTerms([...getBalanceTerms(c), ...getSensoryTermsHere(state, c.id, 'balance')])
  return getFaceOdds(getTestMode(c)).reduce((sum, p, face) => sum + (clears(face + skill) ? p : 0), 0)
}

// spec "Movement", pace: the metres an AP swims in the water the character is
// in, each degree of its swim test as likely as the bot reads it from the
// sheet it knows (a foe's face): perfectly at `metres` per `AP` on a critical
// or a hit, 1 m per 5 AP on a graze or a miss (combat.tex "Swimming").
export function getSwimRate(state: SceneState, id: string, metres: number, AP: number): number {
  const c = state.characters[id]
  const water = getWaterOf(state, id)
  const rate = (d: Degree) => (d === 'graze' || d === 'miss' ? 1 / SWIM_STRUGGLE_AP : metres / AP)
  if (!c || !water) return metres / AP
  const held = getHeldRoll(state, id, 'swim')
  if (held) return rate(getDegree(held.score, water.DL))
  const odds = getDegreeOdds(c, sumTerms(getSwimTestTerms(c)), water.DL)
  return (Object.keys(odds) as Degree[]).reduce((sum, d) => sum + odds[d] * rate(d), 0)
}

// spec "Movement", fall harm: the harm a fall of `height` metres onto `to`
// does the character, each degree of its fall test as likely as the bot reads
// it (combat.tex "Fall skill test", "Fall damage").
export function getFallHarm(state: SceneState, id: string, height: number, to: Coord, w: SpecWeights): number {
  const c = state.characters[id]
  if (!c || height <= 0) return 0
  const ground = state.board?.terrain[coordKey(to)]
  const soft = !!ground && (ground.soft || ground.liquid)
  const skill = sumTerms([...getBalanceTerms(c), ...getSensoryTermsHere(state, id, 'balance')])
  const odds = getDegreeOdds(c, skill, getFallDL(height))
  return (Object.keys(odds) as Degree[]).reduce((sum, d) => {
    if (odds[d] === 0) return sum
    const harm = getFallDeliveries(c, height, soft, d).reduce((h, delivery) => {
      const outcome = outcomeOf(delivery, c)
      return outcome ? h + w.IL * outcome.IL + w.bleed * outcome.bleed : h
    }, 0)
    return sum + odds[d] * harm
  }, 0)
}
