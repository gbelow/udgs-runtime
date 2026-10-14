import type { CampaignCharacter, Character, Degree, Proficiencies } from '../../types'
import { DEGREES } from '../../types'
import { type LivingLevel } from '../../lists'
import type { CampaignState, Settlement } from '../../campaign/types'
import type { Activity, Block, Downtime, Plan, SkillRef, TrainingTarget } from '../types'
import { PlanSchema } from '../types'
import type { Test } from '../../play/test'
import { ABILITIES, ABILITY_FAMILIES, getAbilityLevel, getFamilyStages, isFamilyKey } from '../../abilities'
import { COST_OF_LIVING, DAYS_PER_XP, SELF_TRAINING_YIELD, TRAINER_RATES } from '../../tables'
import { PROFICIENCY_TALENTS, SKILL_TALENTS, getTrainableRaisePrice, isSkillKey, type LearningPrice } from '../../character/rules/learning'
import { getAbilityTrainingPrice } from '../../character/rules/abilities'
import { getLongCampHealing } from '../../character/rules/recovery'
import { skillTermGetters } from '../../character/rules/skills'
import { getKnowledgeTestTerms, isFormalKnowledge, knowledgeName } from '../../character/rules/knowledge'
import { sumTerms } from '../../character/rules/terms'
import { isDead } from '../../character/rules/afflictions'
import { getPartyMembers, getPlace } from '../../campaign/rules/place'
import { getClockOf, getPlayingParties, getTimeBar } from '../../campaign/rules/clock'
import { getPayable } from '../../item/rules/money'

// The character's plan, or an empty one.
export function getPlan(t: Downtime, id: string): Plan {
  return t.downtime.plans[id] ?? PlanSchema.parse({ at: getClockOf(t.campaign, id) ?? 0 })
}

// Who spends the days: everyone alive on the roster in a party in play on a
// timeline.
export function getDowntimeCharacters(state: CampaignState): string[] {
  return getPlayingParties(state).flatMap((pid) => getPartyMembers(state, pid)).filter((id) => state.characters[id] && !isDead(state.characters[id]))
}

// ── training ─────────────────────────────────────────────

// The level being trained toward: the one after the level held.
export function getTrainingLevel(target: TrainingTarget): (c: Character) => number {
  return (c) => {
    switch (target.kind) {
      case 'trainable': return c.trainables[target.key].value + 1
      case 'ability': return isFamilyKey(target.family) ? getAbilityLevel(c, target.family) + 1 : 0
    }
  }
}

// What the next level costs, when it can be trained with XP at all; a talent
// or a karma-priced ability cannot.
export function getTrainingPrice(target: TrainingTarget): (c: Character) => LearningPrice | null {
  return (c) => {
    const price = target.kind === 'trainable' ? getTrainableRaisePrice(target.key)(c)
      : isFamilyKey(target.family) ? getAbilityTrainingPrice(target.family)(c) : null
    return price?.currency === 'XP' ? price : null
  }
}

function getHeldXP(target: TrainingTarget, c: Character): number {
  switch (target.kind) {
    case 'trainable': return c.trainables[target.key].XP
    case 'ability': return c.abilities[target.family]?.XP ?? 0
  }
}

// The XP still missing for the next level; a block trains toward one level
// at a time. Null when it cannot be trained.
export function getXPToNext(target: TrainingTarget): (c: Character) => number | null {
  return (c) => {
    const price = getTrainingPrice(target)(c)
    return price ? Math.max(1, price.amount - getHeldXP(target, c)) : null
  }
}

// creating.tex "Talent and Learning": the talent a target's price is read
// from — the skill's, knowledge's or proficiency's, and for an
// ability the lowest of the talents its next stage lists. A skill the book
// does not let be trained on its own, or a stage with no talent, has none.
export function getTrainingTalent(target: TrainingTarget): (c: Character) => number | null {
  return (c) => {
    switch (target.kind) {
      case 'ability': {
        const next = isFamilyKey(target.family) ? getFamilyStages(target.family)[getAbilityLevel(c, target.family)] : undefined
        const talents = next ? ABILITIES[next].talent : []
        return talents.length > 0 ? Math.min(...talents.map((t) => c.trainables[t.property].value)) : null
      }
      case 'trainable': {
        const talent = isSkillKey(target.key) ? SKILL_TALENTS[target.key] : PROFICIENCY_TALENTS[target.key as keyof Proficiencies]
        return talent ? c.trainables[talent].value : null
      }
    }
  }
}

// story.tex "Training without trainer": "2x talent vs 2x training level".
export function getSelfTrainingTest(target: TrainingTarget): (c: Character) => Test | null {
  return (c) => {
    const talent = getTrainingTalent(target)(c)
    return talent === null ? null : { skill: 2 * talent, DL: 2 * getTrainingLevel(target)(c), explodes: false, scale: 'degrees' }
  }
}

// story.tex "Training without trainer": "miss = 0 XP, graze = N/4 XP, hit
// N/2 XP, crit N XP".
export function getSelfTrainingXP(XP: number, degree: Degree): number {
  return Math.floor(XP * SELF_TRAINING_YIELD[degree])
}

// story.tex "Trainer": the standard rate a day for the level trained toward;
// past the table's last level, its last rate.
export function getTrainerRate(level: number): number {
  return TRAINER_RATES[Math.min(TRAINER_RATES.length, Math.max(1, level)) - 1]
}

export function getTargetName(target: TrainingTarget): string {
  switch (target.kind) {
    case 'trainable': return target.key
    case 'ability': return isFamilyKey(target.family) ? ABILITY_FAMILIES[target.family].family : target.family
  }
}

// ── tests ────────────────────────────────────────────────

// story.tex "Knowledge": a knowledge is tested at "2x Knowledge"; a skill at
// its value.
export function getSkillValue(ref: SkillRef): (c: Character) => number {
  return (c) => sumTerms(ref.kind === 'skill' ? skillTermGetters[ref.key](c) : getKnowledgeTestTerms(ref.name)(c))
}

export function getSkillTest(ref: SkillRef, DL: number): (c: Character) => Test {
  return (c) => ({ skill: getSkillValue(ref)(c), DL, explodes: false, scale: 'degrees' })
}

export function getSkillName(ref: SkillRef): string {
  return ref.kind === 'skill' ? ref.key : ref.name
}

// What a test's skill is trained as; nothing for a specific knowledge, which
// is not trained.
export function getRefTarget(ref: SkillRef): TrainingTarget | null {
  if (ref.kind === 'skill') return { kind: 'trainable', key: ref.key }
  return isFormalKnowledge(ref.name) ? { kind: 'trainable', key: ref.name } : null
}

// story.tex "Job": "If skill test DL is equal or higher than 2x training
// level, this counts as training alone" for the skill the job tests, its
// days giving N = days / 10.
export function getJobTraining(block: Extract<Block, { kind: 'job' }>): (c: Character) => { target: TrainingTarget; XP: number } | null {
  return (c) => {
    const target = getRefTarget(block.test)
    const XP = Math.floor(block.days / DAYS_PER_XP)
    if (!target || XP < 1 || getTrainingPrice(target)(c) === null) return null
    return block.DL >= 2 * getTrainingLevel(target)(c) ? { target, XP } : null
  }
}

// story.tex "Learning tests": the levels gained for the degree, by the order
// miss, graze, hit, crit.
export function getLearningGain(block: Extract<Block, { kind: 'learning' }>, degree: Degree): number {
  return block.gains[DEGREES.indexOf(degree)]
}

// ── days ─────────────────────────────────────────────────

// story.tex "Training": "10 x N" days.
export function getBlockDays(block: Block): number {
  return block.kind === 'training' || block.kind === 'self' ? block.XP * DAYS_PER_XP : block.days
}

// The activity the character is on, a training alone being a training.
export function getActivity(plan: Plan): Activity | null {
  return plan.block ? (plan.block.kind === 'self' ? 'training' : plan.block.kind) : null
}

// The days the activity under way still takes.
export function getPlanDays(plan: Plan): number {
  return plan.block ? getBlockDays(plan.block) - plan.elapsed : 0
}

// ── living ───────────────────────────────────────────────

const OFF_THE_MAP: Settlement = { living: 1 }

// The settlement the character's party stands in, or none on a node that is
// not one; off the map, wherever the table says, at the book's average.
export function getSettlement(state: CampaignState, id: string): Settlement | null {
  const party = state.parties[state.partyOf[id]]
  const place = party ? getPlace(state, party) : null
  return place ? place.node.settlement : OFF_THE_MAP
}

// story.tex "Cost of Living": what the standard costs a day where the
// character is, in coppers.
export function getLivingCost(state: CampaignState, id: string, level: LivingLevel): number {
  return Math.ceil(COST_OF_LIVING[level].cost * (getSettlement(state, id)?.living ?? 1))
}

// The exposure the character rests at: their living standard's, or none
// when someone houses them.
export function getPlanExposure(plan: Plan): number {
  return plan.housed ? 0 : getLivingExposure(plan.living)
}

// survival.tex "Long Camping": the day's healing, 3+3*(health-exposure)/2;
// a negative value works against the character.
export function getDowntimeHealing(c: CampaignCharacter, plan: Plan): number {
  return getLongCampHealing(c, getPlanExposure(plan))
}

// story.tex "Cost of Living": the exposure the standard rests at.
export function getLivingExposure(level: LivingLevel): number {
  return COST_OF_LIVING[level].exposure
}

// ── money ────────────────────────────────────────────────

// story.tex "Healing": the doctor's "heal rate x N in IL and wound": ordinary
// IL first, then each wound's own.
export function getDoctorHealing(block: Extract<Block, { kind: 'doctor' }>, c: CampaignCharacter): number {
  const needed = c.injuries.injuryLevel + c.injuries.wounds.reduce((total, w) => total + w.IL, 0)
  return Math.max(0, Math.min(block.capacity * block.days, needed))
}

// What the activity settles on its last day, in coppers: a job's wage, or
// the doctor's price for what they heal (at most what is hurt now).
export function getBlockSettlement(block: Block, c: CampaignCharacter): number {
  if (block.kind === 'job') return block.wage * block.days
  if (block.kind === 'doctor') return -getDoctorHealing(block, c) * block.price
  return 0
}

// How many of the coming `days` the character can pay for out of their
// purse: living every day unless housed, a trainer's rate on the days of a
// training, and what the activity settles on its last day.
export function getAffordableDays(t: Downtime, id: string, days: number): number {
  const c = t.campaign.characters[id]
  const plan = getPlan(t, id)
  const living = plan.housed ? 0 : getLivingCost(t.campaign, id, plan.living)
  const last = getPlanDays(plan) - 1
  let purse = getPayable(c)
  for (let day = 0; day < days; day++) {
    purse -= living
    if (plan.block?.kind === 'training' && day <= last) purse -= plan.block.rate
    if (plan.block && day === last) purse += getBlockSettlement(plan.block, c)
    if (purse < 0) return day
  }
  return days
}

// ── bars ─────────────────────────────────────────────────

// Why a block cannot be spent as it is.
export function getBlockBar(block: Block, c: Character): string | null {
  if (getBlockDays(block) < 1) return 'needs days'
  switch (block.kind) {
    case 'training':
    case 'self': {
      const toNext = getXPToNext(block.target)(c)
      if (toNext === null) return `${getTargetName(block.target)} cannot be trained with XP now`
      if (block.XP > toNext) return `${toNext} XP reaches the next level`
      if (block.kind === 'self' && !getSelfTrainingTest(block.target)(c)) return 'needs a trainer: no talent to train it alone'
      if (block.kind === 'training' && block.decision === 'pending') return 'waits for the table to find a trainer'
      if (block.kind === 'training' && block.decision === 'refused') return 'no trainer found'
      return null
    }
    case 'learning':
      if (!knowledgeName(block.knowledge)) return 'name the knowledge'
      return isFormalKnowledge(knowledgeName(block.knowledge)) ? `${knowledgeName(block.knowledge)} is a formal knowledge: train it instead` : null
    default: return null
  }
}

// The days a pass covers when the table names none: the longest plan, or one
// day.
export function getDefaultSpan(t: Downtime): number {
  return Math.max(1, ...getDowntimeCharacters(t.campaign).map((id) => getPlanDays(getPlan(t, id))))
}

// Why the days cannot pass now: time must be able to pass (`getTimeBar`),
// every party feeling it that is on the map must be in a settlement, every
// activity must be ready, and every plan paid for.
export function getDowntimeBar(t: Downtime, days: number): string | null {
  const state = t.campaign
  if (days < 1) return 'choose how many days'
  const bar = getTimeBar(state)
  if (bar) return bar
  for (const party of getPlayingParties(state).map((pid) => state.parties[pid])) {
    const place = getPlace(state, party)
    if (place && !place.node.settlement) return `${party.name} is not in a settlement`
  }
  for (const id of getDowntimeCharacters(state)) {
    const c = state.characters[id]
    const name = c.fightName ?? id
    const block = getPlan(t, id).block
    const bar = block && getBlockBar(block, c)
    if (bar) return `${name}: ${bar}`
    const affordable = getAffordableDays(t, id, days)
    if (affordable < days) return `${name} can pay for ${affordable} of ${days} days`
  }
  return null
}
