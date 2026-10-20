import type { Throw } from '../../play/calls'
import type { DieSource } from '../../play/dice'
import type { SlotKind } from '../../types'
import type { Actor } from '../../profiles'
import { commandsOver, playedBy, rollerOf, type CommandOf } from '../../registry'
import type { CampaignUpdater } from '../../campaign/types'
import { getGroupActor } from '../rules/exploration'
import type { CastPlan, Decision, Exploring, ExplorationUpdater, Group, GroupKind } from '../types'
import { adjustMet, answerET, drink, eat, eatFood, passET, takeFromPile, takeItem, toDowntime } from './exploration'
import { addGroup, decide, joinGroup, planCast, removeGroup, setCast, setGroup, setResting, setRoller } from './plans'

// Exploration's presses as data (cf. the scene's registry): each member's
// plan for the coming ET, the groups, what a member eats and drinks and takes
// off the found pile, the ET passed, the DL of what it met changed, a die it
// called for answered, and a party taken into downtime.

export type ExplorationContext = { thrower: Throw; newId: () => string }

const command = commandsOver<Exploring, ExplorationContext>()
const gm = (): Actor => 'gm'
const own = (_: Exploring, id: string): Actor => ({ id })
const onCampaign = (change: CampaignUpdater): ExplorationUpdater => (t) => ({ ...t, campaign: change(t.campaign) })

export const explorationCommands = {
  // a member's own plan
  joinGroup: command((_, id: string, groupId: string) => joinGroup(id, groupId)).by(own),
  rest: command((_, id: string, resting: boolean) => setResting(id, resting)).by(own),
  planCast: command((_, id: string, key: string) => planCast(id, key)).by(own),
  setCast: command((_, id: string, settings: Partial<Omit<CastPlan, 'key'>>) => setCast(id, settings)).by(own),
  decide: command((_, id: string, decision: Decision) => decide(id, decision)).by(own),
  eat: command((_, id: string, nutrition: number) => onCampaign(eat(id, nutrition))).by(own),
  eatFood: command((_, id: string, itemId: string) => onCampaign(eatFood(id, itemId))).by(own),
  takeItem: command((_, id: string, itemId: string) => onCampaign(takeItem(id, itemId))).by(own),
  drink: command((_, id: string) => onCampaign(drink(id))).by(own),
  takeFromPile: command((_, id: string, partyId: string, itemId: string, containerKey: string, slot: SlotKind) => takeFromPile(partyId, itemId, id, containerKey, slot)).by(own),

  // a party's groups, its own business but for the DL, which the GM sets
  addGroup: command((ctx, partyId: string, kind: GroupKind) => addGroup(partyId, kind, ctx.newId)).by((t, partyId) => getGroupActor(t, partyId)),
  removeGroup: command((_, partyId: string, groupId: string) => removeGroup(partyId, groupId)).by((t, partyId) => getGroupActor(t, partyId)),
  setGroup: command((_, partyId: string, groupId: string, settings: Partial<Pick<Group, 'DL' | 'mode' | 'target' | 'seek' | 'tool'>>) => setGroup(partyId, groupId, settings))
    .by((t, partyId, _groupId, settings) => getGroupActor(t, partyId, settings)),
  setRoller: command((_, partyId: string, groupId: string, roller: string) => setRoller(partyId, groupId, roller)).by((t, partyId) => getGroupActor(t, partyId)),

  // the ET passed, and a party taken out of it
  passET: command((ctx) => passET(ctx.thrower, ctx.newId)).by(gm),
  adjustMet: command((_, partyId: string, groupId: string, index: number, adjust: number) => adjustMet(partyId, groupId, index, adjust)).by(gm),
  toDowntime: command((_, partyId: string) => toDowntime(partyId)).by(gm),

  // a die the ET called for, answered by whoever throws it
  answer: command((ctx, callId: string, die: number, source: DieSource) => answerET(callId, die, source, ctx.thrower, ctx.newId))
    .by((t, callId) => rollerOf(t.exploration.calls, callId)),
}

export type ExplorationCommand = CommandOf<typeof explorationCommands>

export const { barOf: getExplorationCommandBar, toUpdater: toExplorationUpdater } = playedBy<Exploring, ExplorationContext, typeof explorationCommands>(explorationCommands)
