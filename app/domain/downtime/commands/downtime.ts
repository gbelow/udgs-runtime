import { getRosterName } from '../../campaign/rules/roster'
import type { CampaignCharacter, Character } from '../../types'
import type { CampaignState } from '../../campaign/types'
import type { Block, Downtime, DowntimeResult, DowntimeUpdater, Plan, SkillRef, TrainingTarget } from '../types'
import type { Test } from '../../play/test'
import { answerCall, getOpenCalls, makeCaller, toCallRoll, toTable, type CallResult, type CallSpec, type Throw } from '../../play/calls'
import type { DieSource } from '../../play/dice'
import { getDowntimeResultLines } from '../projections/downtime'
import { isFamilyKey } from '../../abilities'
import { addExhaustion, addIL, heal } from '../../character/commands/heal'
import { addAbilityXP, addTrainingXP, raiseSpecificKnowledge } from '../../character/commands/learning'
import { knowledgeName } from '../../character/rules/knowledge'
import { getLearnedLevel } from '../../character/rules/skillRef'
import { getRestRecovery } from '../../character/rules/recovery'
import { pay, receive } from '../../item/commands/money'
import { passETs } from '../../campaign/commands/clock'
import { record } from '../../campaign/commands/journal'
import { setPartySequence } from '../../campaign/commands/parties'
import { ETS_PER_DAY, describeSpan, getClockOf, getPlayingParties } from '../../campaign/rules/clock'
import {
  getBlockDays, getBlockSettlement, getDoctorHealing, getDowntimeBar, getDowntimeCharacters, getDowntimeHealing, getJobTraining,
  getLivingCost, getPlan, getPlanExposure, getSelfTrainingTest, getSelfTrainingXP, getSkillName, getSkillTest, getTargetName, getToExplorationBar,
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

// A test downtime makes: what its die came to, or null while the table has
// yet to roll it.
type Tester = (spec: CallSpec) => CallResult | null

type Resolved = { c: CampaignCharacter; result: Omit<DowntimeResult, 'name'> }

// story.tex "Downtime": what an activity comes to once its days are over.
function resolveBlock(id: string, c: CampaignCharacter, block: Block, test: Tester): Resolved {
  const roll = (what: string, made: Test) => {
    const result = test({ id: `${block.kind}:${id}`, roller: id, label: what, test: made })
    return result ? toCallRoll(result) : null
  }
  const rollSkill = (what: string, ref: SkillRef, DL: number) => roll(what, getSkillTest(ref, DL)(c))
  const waiting = (what: string): Resolved => ({ c, result: { what, roll: null, note: '' } })
  switch (block.kind) {
    case 'training':
      return { c: addXP(block.target, block.XP)(c), result: { what: `training ${getTargetName(block.target)}`, roll: null, note: `+${block.XP} XP` } }
    case 'self': {
      const what = `training ${getTargetName(block.target)} alone`
      const test = getSelfTrainingTest(block.target)(c)
      if (!test) return { c, result: { what, roll: null, note: 'no talent to train it' } }
      const rolled = roll(what, test)
      if (!rolled) return waiting(what)
      const XP = getSelfTrainingXP(block.XP, rolled.degree)
      return { c: addXP(block.target, XP)(c), result: { what, roll: rolled, note: `+${XP} XP` } }
    }
    case 'job': {
      const what = `job (${getSkillName(block.test)})`
      const rolled = rollSkill(what, block.test, block.DL)
      if (!rolled) return waiting(what)
      const training = getJobTraining(block)(c)
      const XP = training ? getSelfTrainingXP(training.XP, rolled.degree) : 0
      const note = `earned ${getBlockSettlement(block, c)} CP${training ? `, +${XP} XP ${getTargetName(training.target)} as training alone` : ''}`
      return { c: training ? addXP(training.target, XP)(c) : c, result: { what, roll: rolled, note } }
    }
    case 'doctor': {
      const healed = getDoctorHealing(block, c)
      return { c: doctor(c, healed), result: { what: 'doctor', roll: null, note: `healed ${healed} IL for ${healed * block.price} CP` } }
    }
    case 'learning': {
      const name = knowledgeName(block.knowledge)
      const what = `learning ${name} (${getSkillName(block.test)})`
      const rolled = rollSkill(what, block.test, block.DL)
      if (!rolled) return waiting(what)
      const { held, level } = getLearnedLevel(block, rolled.degree)(c)
      const note = level > held ? `${name} ${held} → ${level}` : 'nothing learned'
      return { c: raiseSpecificKnowledge(name, level)(c), result: { what, roll: rolled, note } }
    }
  }
}

type Lived = { c: CampaignCharacter; plan: Plan; results: DowntimeResult[] }

// One character's days: each lived, the activity resolved on its last day,
// and everything spent and earned settled out of the purse at the end. An
// activity that time spent elsewhere broke into is lost.
function liveDays(t: Downtime, id: string, days: number, test: Tester): Lived {
  const name = getRosterName(t.campaign, id)
  let c = t.campaign.characters[id]
  const start = getPlan(t, id)
  const results: DowntimeResult[] = []
  const interrupted = start.block && start.elapsed > 0 && (start.at !== getClockOf(t.campaign, id))
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
    const resolved = resolveBlock(id, c, block, test)
    c = resolved.c
    results.push({ name, ...resolved.result })
    plan = { ...plan, block: null, elapsed: 0 }
  }
  c = fed(spent > 0 ? pay(spent)(c) : receive(-spent)(c))
  return { c, plan, results }
}

// story.tex "Downtime": the days pass at once for every party in play on a
// timeline, each member living and doing what they planned, and each party's
// clock moves on by them. An activity ending in a test calls for its die, and
// the days wait on every die called for, keeping how many they are.
export function passDays(days: number, thrown: Throw = toTable(() => 0)): DowntimeUpdater {
  return (t) => {
    if (getDowntimeBar(t, days)) return t
    const ids = getDowntimeCharacters(t.campaign)
    const caller = makeCaller(t.downtime.calls, thrown)
    const lived = ids.map((id) => ({ id, ...liveDays(t, id, days, caller.test) }))
    if (getOpenCalls(caller.calls).length > 0) return { ...t, downtime: { ...t.downtime, calls: caller.calls, passing: days } }
    const characters = { ...t.campaign.characters, ...Object.fromEntries(lived.map(({ id, c }) => [id, c])) }
    const playing = getPlayingParties(t.campaign, 'downtime')
    const byParty = Map.groupBy(lived, ({ id }) => t.campaign.partyOf[id])
    const recorded = playing.reduce<CampaignState>((campaign, partyId) => record({
      kind: 'days', party: partyId, title: `${describeSpan(days * ETS_PER_DAY)} of downtime`,
      lines: getDowntimeResultLines((byParty.get(partyId) ?? []).flatMap((l) => l.results)),
    })(campaign), { ...t.campaign, characters })
    const moved = passETs(days * ETS_PER_DAY, playing)(recorded)
    const fedAll = { ...moved, characters: { ...moved.characters, ...Object.fromEntries(ids.map((id) => [id, fed(moved.characters[id])])) } }
    const plans = Object.fromEntries(lived.map(({ id, plan }) => [id, { ...plan, at: getClockOf(fedAll, id) ?? 0 }]))
    return { campaign: fedAll, downtime: { ...t.downtime, plans, calls: {}, passing: null, results: lived.flatMap((l) => l.results) } }
  }
}

// A die for a test the days called for, typed in from the table or rolled on
// the screen; the last die called for lets the days pass.
export function answerDowntime(callId: string, die: number, source: DieSource, thrown: Throw = toTable(() => 0)): DowntimeUpdater {
  return (t) => {
    const calls = answerCall(t.downtime.calls, callId, die, source)
    if (calls === t.downtime.calls) return t
    const answered = { ...t, downtime: { ...t.downtime, calls } }
    const days = t.downtime.passing
    return getOpenCalls(calls).length > 0 || days === null ? answered : passDays(days, thrown)(answered)
  }
}

// The party leaves downtime to explore again, refused as
// `getToExplorationBar` says.
export function toExploration(partyId: string): DowntimeUpdater {
  return (t) => (getToExplorationBar(t, partyId) ? t : { ...t, campaign: setPartySequence(partyId, 'exploration')(t.campaign) })
}
