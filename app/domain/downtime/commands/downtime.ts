import type { CampaignCharacter, Character } from '../../types'
import type { Block, Downtime, DowntimeResult, DowntimeUpdater, Plan, SkillRef, TrainingTarget } from '../types'
import type { Dice } from '../../play/dice'
import { resolveTest, toRoll, type TestRoll } from '../../play/test'
import { isFamilyKey } from '../../abilities'
import { addExhaustion, addIL, heal } from '../../character/commands/heal'
import { addAbilityXP, addTrainingXP, raiseSpecificKnowledge } from '../../character/commands/learning'
import { getRestRecovery } from '../../character/rules/recovery'
import { pay, receive } from '../../item/commands/money'
import { passETs } from '../../campaign/commands/clock'
import { ETS_PER_DAY } from '../../campaign/rules/clock'
import {
  getBlockDays, getBlockSettlement, getDoctorHealing, getDowntimeBar, getDowntimeCharacters, getDowntimeHealing, getJobTraining, getLearningGain,
  getLivingCost, getPlan, getPlanExposure, getSelfTrainingTest, getSelfTrainingXP, getSkillName, getSkillTest, getTargetName,
} from '../rules/downtime'

function addXP(target: TrainingTarget, XP: number): <C extends Character>(c: C) => C {
  const train = (c: Character): Character => {
    if (XP <= 0) return c
    switch (target.kind) {
      case 'trainable': return addTrainingXP(target.key, XP)(c)
      case 'ability': return isFamilyKey(target.family) ? addAbilityXP(target.family, XP)(c) : c
    }
  }
  return <C extends Character>(c: C): C => train(c) as C
}

// story.tex "Cost of Living" covers "food, water": the day's hunger and thirst
// are eaten away.
const fed = (c: CampaignCharacter): CampaignCharacter => ({ ...c, resources: { ...c.resources, hunger: 0, thirst: 0 } })

// survival.tex "Long Camping": the day's healing; "Exhaustion should be zero
// by the second day": the first day lowers it as three rests do, and it is
// gone after.
function liveDay(c: CampaignCharacter, plan: Plan, day: number): CampaignCharacter {
  const rested = day === 0 ? addExhaustion(-3 * getRestRecovery(getPlanExposure(plan)))(c) : addExhaustion(-c.resources.exhaustion)(c)
  const healing = getDowntimeHealing(rested, plan)
  return healing < 0 ? addIL(-healing)(rested) : heal(Math.min(healing, rested.injuries.injuryLevel))(rested)
}

// story.tex "Healing": ordinary IL first, then each wound's own; a wound
// healed to none is gone.
function doctor(c: CampaignCharacter, amount: number): CampaignCharacter {
  const ordinary = Math.min(amount, c.injuries.injuryLevel)
  let left = amount - ordinary
  const wounds = c.injuries.wounds.flatMap((w) => {
    const healed = Math.min(left, w.IL)
    left -= healed
    return w.IL - healed > 0 ? [{ ...w, IL: w.IL - healed }] : []
  })
  return { ...c, injuries: { ...c.injuries, injuryLevel: c.injuries.injuryLevel - ordinary, wounds } }
}

const rollSkill = (c: Character, test: SkillRef, DL: number, dice: Dice): TestRoll => toRoll(resolveTest(getSkillTest(test, DL)(c), dice))

type Resolved = { c: CampaignCharacter; result: Omit<DowntimeResult, 'name'> }

// story.tex "Downtime": what an activity comes to once its days are over.
function resolveBlock(c: CampaignCharacter, block: Block, dice: Dice): Resolved {
  switch (block.kind) {
    case 'training':
      return { c: addXP(block.target, block.XP)(c), result: { what: `training ${getTargetName(block.target)}`, roll: null, note: `+${block.XP} XP` } }
    case 'self': {
      const what = `training ${getTargetName(block.target)} alone`
      const test = getSelfTrainingTest(block.target)(c)
      if (!test) return { c, result: { what, roll: null, note: 'no talent to train it' } }
      const roll = toRoll(resolveTest(test, dice))
      const XP = getSelfTrainingXP(block.XP, roll.degree)
      return { c: addXP(block.target, XP)(c), result: { what, roll, note: `+${XP} XP` } }
    }
    case 'job': {
      const roll = rollSkill(c, block.test, block.DL, dice)
      const training = getJobTraining(block)(c)
      const XP = training ? getSelfTrainingXP(training.XP, roll.degree) : 0
      const note = `earned ${getBlockSettlement(block, c)} CP${training ? `, +${XP} XP ${getTargetName(training.target)} as training alone` : ''}`
      return { c: training ? addXP(training.target, XP)(c) : c, result: { what: `job (${getSkillName(block.test)})`, roll, note } }
    }
    case 'doctor': {
      const healed = getDoctorHealing(block, c)
      return { c: doctor(c, healed), result: { what: 'doctor', roll: null, note: `healed ${healed} IL for ${healed * block.price} CP` } }
    }
    case 'learning': {
      const roll = rollSkill(c, block.test, block.DL, dice)
      const held = c.specificKnowledges[block.knowledge] ?? 0
      const level = Math.min(block.max, held + getLearningGain(block, roll.degree))
      const note = level > held ? `${block.knowledge} ${held} → ${level}` : 'nothing learned'
      return { c: raiseSpecificKnowledge(block.knowledge, level)(c), result: { what: `learning ${block.knowledge} (${getSkillName(block.test)})`, roll, note } }
    }
  }
}

type Lived = { c: CampaignCharacter; plan: Plan; results: DowntimeResult[] }

// One character's days: each lived, the activity resolved on its last day,
// and everything spent and earned settled out of the purse at the end. An
// activity that time spent elsewhere broke into is lost.
function liveDays(t: Downtime, id: string, days: number, dice: Dice): Lived {
  const name = t.campaign.characters[id].fightName ?? id
  let c = t.campaign.characters[id]
  const start = getPlan(t, id)
  const results: DowntimeResult[] = []
  const interrupted = start.block && start.elapsed > 0 && (start.at !== t.campaign.clock || t.campaign.out.includes(id))
  if (interrupted) results.push({ name, what: start.block!.kind, roll: null, note: 'interrupted, the days spent on it are lost' })
  let plan: Plan = interrupted ? { ...start, block: null, elapsed: 0 } : start
  const living = plan.housed ? 0 : getLivingCost(t.campaign, id, plan.living)
  let spent = 0
  for (let day = 0; day < days; day++) {
    c = liveDay(fed(c), plan, day)
    spent += living
    const block = plan.block
    if (!block) continue
    if (block.kind === 'training') spent += block.rate
    if (plan.elapsed + 1 < getBlockDays(block)) {
      plan = { ...plan, elapsed: plan.elapsed + 1 }
      continue
    }
    spent -= getBlockSettlement(block, c)
    const resolved = resolveBlock(c, block, dice)
    c = resolved.c
    results.push({ name, ...resolved.result })
    plan = { ...plan, block: null, elapsed: 0 }
  }
  c = fed(spent > 0 ? pay(spent)(c) : receive(-spent)(c))
  return { c, plan, results }
}

// story.tex "Downtime": the days pass for everyone on the roster at once,
// each living and doing what they planned, and the clock moves on by them.
export function passDays(days: number, dice: Dice): DowntimeUpdater {
  return (t) => {
    if (getDowntimeBar(t, days)) return t
    const ids = getDowntimeCharacters(t.campaign)
    const lived = ids.map((id) => ({ id, ...liveDays(t, id, days, dice) }))
    const characters = { ...t.campaign.characters, ...Object.fromEntries(lived.map(({ id, c }) => [id, c])) }
    const moved = passETs(days * ETS_PER_DAY)({ ...t.campaign, characters, out: [] })
    const fedAll = { ...moved, characters: { ...moved.characters, ...Object.fromEntries(ids.map((id) => [id, fed(moved.characters[id])])) } }
    const plans = Object.fromEntries(lived.map(({ id, plan }) => [id, { ...plan, at: fedAll.clock }]))
    return { campaign: fedAll, downtime: { ...t.downtime, plans, results: lived.flatMap((l) => l.results) } }
  }
}
