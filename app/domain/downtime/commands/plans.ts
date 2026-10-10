import type { LivingLevel } from '../../lists'
import type { BlockKind, Downtime, DowntimeUpdater, Plan, SkillRef, TrainingTarget } from '../types'
import { BlockSchema, DECISIONS } from '../types'
import { getActivityBar, getPlan, getTrainerRate, getTrainingLevel, isTrainingTarget } from '../rules/downtime'

const onPlan = (id: string, update: (plan: Plan, t: Downtime) => Plan): DowntimeUpdater =>
  (t) => (t.campaign.characters[id]
    ? { ...t, downtime: { ...t.downtime, plans: { ...t.downtime.plans, [id]: update(getPlan(t, id), t) } } }
    : t)

// story.tex "Downtime": "Only one thing can be done per day": an activity is
// taken up only when none is under way.
const takeUp = (id: string, make: (plan: Plan, t: Downtime) => unknown): DowntimeUpdater =>
  onPlan(id, (plan, t) => (getActivityBar(plan) ? plan : { ...plan, block: BlockSchema.parse(make(plan, t)), elapsed: 0 }))

// story.tex "Cost of Living": the standard the character lives at.
export function setLiving(id: string, living: LivingLevel): DowntimeUpdater {
  return onPlan(id, (plan) => ({ ...plan, living }))
}

// Someone else puts the character up: no cost of living.
export function setHoused(id: string, housed: boolean): DowntimeUpdater {
  return onPlan(id, (plan) => ({ ...plan, housed }))
}

const DEFAULT_TEST: SkillRef = { kind: 'skill', key: 'persuasion' }

// A training, asked of the table with the standard rate for the level
// trained toward, or done alone.
export function addTraining(id: string, target: TrainingTarget, withTrainer: boolean): DowntimeUpdater {
  if (!isTrainingTarget(target)) return (t) => t
  return takeUp(id, (_plan, t) => (withTrainer
    ? { kind: 'training', target, rate: getTrainerRate(getTrainingLevel(target)(t.campaign.characters[id])) }
    : { kind: 'self', target }))
}

// A job, a doctor or a learning test, at their defaults for the table to set.
export function addBlock(id: string, kind: Exclude<BlockKind, 'training' | 'self'>): DowntimeUpdater {
  return takeUp(id, () => ({ kind, test: DEFAULT_TEST }))
}

// Changes the activity's settings; anything its kind does not take is dropped.
export function setBlock(id: string, patch: Record<string, unknown>): DowntimeUpdater {
  return onPlan(id, (plan) => {
    const parsed = plan.block ? BlockSchema.safeParse({ ...plan.block, ...patch, kind: plan.block.kind }) : null
    return parsed?.success ? { ...plan, block: parsed.data } : plan
  })
}

// story.tex "Learning tests": the levels a degree gains, by the order miss,
// graze, hit, crit.
export function setLearningGain(id: string, degree: number, gain: number): DowntimeUpdater {
  return onPlan(id, (plan) => {
    const block = plan.block
    if (block?.kind !== 'learning') return plan
    const gains = block.gains.map((g, i) => (i === degree ? gain : g)) as typeof block.gains
    return { ...plan, block: { ...block, gains } }
  })
}

// The table finds a trainer, or does not.
export function decideTraining(id: string, decision: (typeof DECISIONS)[number]): DowntimeUpdater {
  return setBlock(id, { decision })
}

// The activity is dropped, with the days spent on it.
export function dropBlock(id: string): DowntimeUpdater {
  return onPlan(id, (plan) => ({ ...plan, block: null, elapsed: 0 }))
}
