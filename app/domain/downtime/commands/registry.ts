import type { Throw } from '../../play/calls'
import type { DieSource } from '../../play/dice'
import type { LivingLevel } from '../../lists'
import type { Actor } from '../../profiles'
import { commandsOver, playedBy, rollerOf, type CommandOf } from '../../registry'
import { getBlockActor } from '../rules/downtime'
import { DECISIONS, type Activity, type Downtime, type TrainingTarget } from '../types'
import { answerDowntime, passDays, toExploration } from './downtime'
import { chooseActivity, chooseTraining, decideTraining, dropBlock, setBlock, setHoused, setLearningGain, setLiving } from './plans'

// Downtime's presses as data (cf. the scene's registry): each character's
// living and activity, the terms of it the table sets, the days passed, a die
// they called for answered, and a party taken back to exploring.

export type DowntimeContext = { thrower: Throw }

const command = commandsOver<Downtime, DowntimeContext>()
const gm = (): Actor => 'gm'
const own = (_: Downtime, id: string): Actor => ({ id })

export const downtimeCommands = {
  setLiving: command((_, id: string, living: LivingLevel) => setLiving(id, living)).by(own),
  setHoused: command((_, id: string, housed: boolean) => setHoused(id, housed)).by(own),
  chooseTraining: command((_, id: string, target: TrainingTarget, withTrainer: boolean) => chooseTraining(id, target, withTrainer)).by(own),
  chooseActivity: command((_, id: string, activity: Exclude<Activity, 'training'>) => chooseActivity(id, activity)).by(own),
  drop: command((_, id: string) => dropBlock(id)).by(own),
  // what the table sets of an activity is the GM's
  setBlock: command((_, id: string, patch: Record<string, unknown>) => setBlock(id, patch)).by((_, id, patch) => getBlockActor(id, patch)),
  setLearningGain: command((_, id: string, degree: number, gain: number) => setLearningGain(id, degree, gain)).by((_, id, _degree, gain) => getBlockActor(id, { gains: gain })),
  decide: command((_, id: string, decision: (typeof DECISIONS)[number]) => decideTraining(id, decision)).by((_, id, decision) => getBlockActor(id, { decision })),

  passDays: command((ctx, days: number) => passDays(days, ctx.thrower)).by(gm),
  toExploration: command((_, partyId: string) => toExploration(partyId)).by(gm),

  // a die the days called for, answered by whoever throws it
  answer: command((ctx, callId: string, die: number, source: DieSource) => answerDowntime(callId, die, source, ctx.thrower))
    .by((t, callId) => rollerOf(t.downtime.calls, callId)),
}

export type DowntimeCommand = CommandOf<typeof downtimeCommands>

export const { barOf: getDowntimeCommandBar, toUpdater: toDowntimeUpdater } = playedBy<Downtime, DowntimeContext, typeof downtimeCommands>(downtimeCommands)
