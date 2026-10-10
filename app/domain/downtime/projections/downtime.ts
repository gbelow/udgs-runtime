import type { CampaignCharacter, Character, Proficiencies, Skills } from '../../types'
import { ProficienciesSchema, SkillsSchema } from '../../types'
import { LIVING_LEVELS, knowledges_list, type LivingLevel } from '../../lists'
import type { CampaignState } from '../../campaign/types'
import type { Block, Downtime, DowntimeResult, DowntimeState, SkillRef, TrainingTarget } from '../types'
import { ABILITY_FAMILIES, type FamilyKey } from '../../abilities'
import { perPair, perState } from '../../perState'
import { formatMoney, getPayable } from '../../item/rules/money'
import {
  getActivityBar, getAffordableDays, getBlockBar, getBlockDays, getDefaultSpan, getDoctorHealing, getDowntimeBar, getDowntimeCharacters,
  getDowntimeHealing, getJobTraining, getLivingCost, getLivingExposure, getPlan, getPlanDays, getPlanExposure, getSelfTrainingTest, getSettlement,
  getSkillName, getSkillValue, getTargetName, getTrainingLevel, getXPToNext, isFormalKnowledge,
} from '../rules/downtime'

export type DowntimeTest = { skill: number; DL: number; label: string }
export type BlockView = {
  block: Block
  label: string
  // the last day of the coming span it takes, counted from 1, and the days
  // already spent on it
  lastDay: number
  elapsed: number
  cost: string
  test: DowntimeTest | null
  // the skill option a job or learning test is tested with
  testId: string | null
  yields: string
  bar: string | null
}
export type LivingOption = { level: LivingLevel; cost: string; exposure: number }
export type DowntimeCharacterView = {
  id: string
  name: string
  isActive: boolean
  living: LivingLevel
  housed: boolean
  livingOptions: LivingOption[]
  // survival.tex "Long Camping": the day's healing at the exposure rested at,
  // and how it is reached
  dailyHealing: number
  healing: string
  purse: string
  planDays: number
  affordable: number
  short: boolean
  block: BlockView | null
  // why another activity cannot be taken up now
  activityBar: string | null
  // the specific knowledges held, for a learning test to raise
  specific: string[]
}
export type TrainingOption = {
  id: string
  target: TrainingTarget
  label: string
  level: number
  toNext: number
  alone: DowntimeTest | null
}
export type SkillOption = { id: string; ref: SkillRef; label: string; value: number }
export type DowntimePanel = {
  days: number
  defaultSpan: number
  settled: string | null
  bar: string | null
  characters: DowntimeCharacterView[]
  results: DowntimeResult[]
}

const rangeOf = (XP: number) => [0, 0.25, 0.5, 1].map((share) => Math.floor(XP * share)).join('/')
const skillId = (ref: SkillRef) => `${ref.kind}:${getSkillName(ref)}`

function selfTest(target: TrainingTarget, c: Character): DowntimeTest | null {
  const test = getSelfTrainingTest(target)(c)
  return test ? { skill: test.skill, DL: test.DL, label: '2× talent vs 2× training level' } : null
}

function skillTest(ref: SkillRef, DL: number, c: Character): DowntimeTest {
  return { skill: getSkillValue(ref)(c), DL, label: getSkillName(ref) }
}

function blockView(c: CampaignCharacter, block: Block, elapsed: number): BlockView {
  const days = getBlockDays(block)
  const base = { block, lastDay: days - elapsed, elapsed, bar: getBlockBar(block, c), testId: 'test' in block ? skillId(block.test) : null }
  switch (block.kind) {
    case 'training':
    case 'self': {
      const label = `training ${getTargetName(block.target)} → ${getTrainingLevel(block.target)(c)}`
      return block.kind === 'training'
        ? { ...base, label, cost: `${formatMoney(block.rate)} × ${days} days = ${formatMoney(block.rate * days)}`, test: null, yields: `+${block.XP} XP` }
        : { ...base, label: `${label} alone`, cost: '—', test: selfTest(block.target, c), yields: `${rangeOf(block.XP)} XP (miss/graze/hit/crit)` }
    }
    case 'job': {
      const training = getJobTraining(block)(c)
      return {
        ...base, label: `job (${getSkillName(block.test)})`, cost: '—', test: skillTest(block.test, block.DL, c),
        yields: `${formatMoney(block.wage)} × ${block.days} days = ${formatMoney(block.wage * block.days)}${training ? `; as training alone ${rangeOf(training.XP)} XP ${getTargetName(training.target)}` : ''}`,
      }
    }
    case 'doctor': {
      const healed = getDoctorHealing(block, c)
      return { ...base, label: 'doctor', cost: `${formatMoney(block.price)} per IL × ${healed} IL = ${formatMoney(block.price * healed)}`, test: null, yields: `heals up to ${healed} IL (${block.capacity} a day, IL then wounds)` }
    }
    case 'learning':
      return {
        ...base, label: `learning ${block.knowledge || '…'}`, cost: '—', test: skillTest(block.test, block.DL, c),
        yields: `+${block.gains.join('/')} levels (miss/graze/hit/crit), up to ${block.max}`,
      }
  }
}

function characterView(t: Downtime, id: string, days: number): DowntimeCharacterView {
  const c = t.campaign.characters[id]
  const plan = getPlan(t, id)
  const affordable = getAffordableDays(t, id, days)
  return {
    id,
    name: c.fightName ?? id,
    isActive: t.campaign.activeCharacterId === id,
    living: plan.living,
    housed: plan.housed,
    livingOptions: LIVING_LEVELS.map((level) => ({ level, cost: formatMoney(getLivingCost(t.campaign, id, level)), exposure: getLivingExposure(level) })),
    dailyHealing: getDowntimeHealing(c, plan),
    healing: `3+3×(health−exposure ${getPlanExposure(plan)})/2, never below 0`,
    purse: formatMoney(getPayable(c)),
    planDays: getPlanDays(plan),
    affordable,
    short: affordable < days,
    block: plan.block ? blockView(c, plan.block, plan.elapsed) : null,
    activityBar: getActivityBar(plan),
    specific: Object.keys(c.knowledges).filter((name) => !isFormalKnowledge(name)),
  }
}

// One panel per state and span: the campaign and what downtime keeps are
// replaced on every write, so a pair already seen has its views known.
const panels = perPair(({ a: campaign, b: downtime }: { a: CampaignState; b: DowntimeState }) => {
  const t: Downtime = { campaign, downtime }
  const views = new Map<number | null, DowntimePanel>()
  return (span: number | null): DowntimePanel => {
    const known = views.get(span)
    if (known) return known
    const defaultSpan = getDefaultSpan(t)
    const days = span ?? defaultSpan
    const active = campaign.activeCharacterId
    const settlement = active ? getSettlement(campaign, active) : null
    const view: DowntimePanel = {
      days,
      defaultSpan,
      settled: settlement ? (settlement.living === 1 ? 'average cost of living' : `cost of living ×${settlement.living}`) : null,
      bar: getDowntimeBar(t, days),
      characters: getDowntimeCharacters(campaign).map((id) => characterView(t, id, days)),
      results: downtime.results,
    }
    views.set(span, view)
    return view
  }
})

// story.tex "Downtime" — everyone's plan for the coming days, what each
// activity costs, tests and yields, how long each can pay for it, and what
// the last days came to.
export function getDowntimePanel(t: Downtime, span: number | null): DowntimePanel {
  return panels(t.campaign, t.downtime)(span)
}

const TRAINING_TARGETS: TrainingTarget[] = [
  ...([...Object.keys(SkillsSchema.shape), ...Object.keys(ProficienciesSchema.shape)] as (keyof Skills | keyof Proficiencies)[]).map((key): TrainingTarget => ({ kind: 'trainable', key })),
  ...knowledges_list.map((name): TrainingTarget => ({ kind: 'knowledge', name })),
  ...(Object.keys(ABILITY_FAMILIES) as FamilyKey[]).map((family): TrainingTarget => ({ kind: 'ability', family })),
]

const targetId = (target: TrainingTarget) =>
  target.kind === 'trainable' ? `trainable:${target.key}` : target.kind === 'knowledge' ? `knowledge:${target.name}` : `ability:${target.family}`

// What the character can train: every skill, proficiency, formal knowledge
// and ability whose next level is bought with XP, with the level it reaches,
// the XP it still needs, and the test of training it alone.
export const getTrainingOptions = perState((c: Character): TrainingOption[] => TRAINING_TARGETS.flatMap((target) => {
  const toNext = getXPToNext(target)(c)
  return toNext === null ? [] : [{ id: targetId(target), target, label: getTargetName(target), level: getTrainingLevel(target)(c), toNext, alone: selfTest(target, c) }]
}))

const SKILL_REFS: SkillRef[] = (Object.keys(SkillsSchema.shape) as (keyof Skills)[]).map((key) => ({ kind: 'skill', key }))

// story.tex "Job": "arbitrary skill or knowledge" — every skill and held
// knowledge, at the value a test reads.
export const getSkillOptions = perState((c: Character): SkillOption[] => [
  ...SKILL_REFS,
  ...Object.keys(c.knowledges).map((name): SkillRef => ({ kind: 'knowledge', name })),
].map((ref) => ({ id: skillId(ref), ref, label: ref.kind === 'knowledge' ? `${ref.name} (2× knowledge)` : ref.key, value: getSkillValue(ref)(c) })))
