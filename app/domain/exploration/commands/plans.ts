import type { CastPlan, Decision, ExplorationState, ExplorationUpdater, Group, GroupKind } from '../types'
import { CastPlanSchema, GroupSchema } from '../types'
import { getDecisionsCalled, getExplorationBar } from '../rules/exploration'
import { getETCastBar, getETCastCount, getETCastTargets } from '../rules/casting'
import { isSpellKey } from '../../spells'

const onExploration = (update: (e: ExplorationState) => ExplorationState): ExplorationUpdater =>
  (t) => ({ ...t, exploration: update(t.exploration) })

const withGroup = (partyId: string, groupId: string, update: (g: Group) => Group): ExplorationUpdater =>
  onExploration((e) => {
    const group = e.groups[partyId]?.[groupId]
    return group ? { ...e, groups: { ...e.groups, [partyId]: { ...e.groups[partyId], [groupId]: update(group) } } } : e
  })

// Out of any group, rest and cast the character planned.
function clearPlan(id: string, e: ExplorationState): ExplorationState {
  const groups = Object.fromEntries(Object.entries(e.groups).map(([pid, gs]) => [pid, Object.fromEntries(Object.entries(gs).map(([gid, g]) =>
    [gid, { ...g, members: g.members.filter((m) => m !== id), roller: g.roller === id ? null : g.roller }]))]))
  const { [id]: _cast, ...casts } = e.casts
  return { ...e, groups, resting: e.resting.filter((r) => r !== id), casts }
}

export function addGroup(partyId: string, kind: GroupKind, newId: () => string): ExplorationUpdater {
  return (t) => (t.campaign.parties[partyId]
    ? onExploration((e) => ({ ...e, groups: { ...e.groups, [partyId]: { ...e.groups[partyId], [newId()]: GroupSchema.parse({ kind }) } } }))(t)
    : t)
}

export function removeGroup(partyId: string, groupId: string): ExplorationUpdater {
  return onExploration((e) => {
    if (!e.groups[partyId]) return e
    const { [groupId]: _gone, ...groups } = e.groups[partyId]
    return { ...e, groups: { ...e.groups, [partyId]: groups } }
  })
}

// The table's settings for the group's test.
export function setGroup(partyId: string, groupId: string, settings: Partial<Pick<Group, 'DL' | 'mode' | 'target' | 'seek' | 'tool'>>): ExplorationUpdater {
  return withGroup(partyId, groupId, (g) => ({ ...g, ...settings }))
}

// "only one character rolls for it": one of the group's members.
export function setRoller(partyId: string, groupId: string, roller: string): ExplorationUpdater {
  return withGroup(partyId, groupId, (g) => (g.members.includes(roller) ? { ...g, roller } : g))
}

// The character goes with this group of their party for the coming ET,
// leaving whatever else they planned.
export function joinGroup(id: string, groupId: string): ExplorationUpdater {
  return (t) => {
    const partyId = t.campaign.partyOf[id]
    if (getExplorationBar(t.campaign, id) || !t.exploration.groups[partyId]?.[groupId]) return t
    const cleared = { ...t, exploration: clearPlan(id, t.exploration) }
    return withGroup(partyId, groupId, (g) => ({ ...g, members: [...g.members, id], roller: g.roller ?? id }))(cleared)
  }
}

// The character rests the coming ET, or, with false, is idle.
export function setResting(id: string, resting: boolean): ExplorationUpdater {
  return (t) => {
    if (getExplorationBar(t.campaign, id)) return t
    const cleared = clearPlan(id, t.exploration)
    return { ...t, exploration: resting ? { ...cleared, resting: [...cleared.resting, id] } : cleared }
  }
}

// What happens to a character forced to rest while their group goes away.
export function decide(id: string, decision: Decision): ExplorationUpdater {
  return (t) => {
    const { opening } = t.exploration
    if (!opening || !getDecisionsCalled(t).includes(id)) return t
    return { ...t, exploration: { ...t.exploration, opening: { ...opening, decisions: { ...opening.decisions, [id]: decision } } } }
  }
}

// The character casts this spell over the coming ET, leaving whatever else
// they planned.
export function planCast(id: string, key: string): ExplorationUpdater {
  return (t) => {
    const c = t.campaign.characters[id]
    if (!c || getExplorationBar(t.campaign, id) || getETCastBar(c, key)) return t
    const cleared = clearPlan(id, t.exploration)
    return { ...t, exploration: { ...cleared, casts: { ...cleared.casts, [id]: CastPlanSchema.parse({ key }) } } }
  }
}

// The table's settings for the cast. Only those in the caster's party are
// aimed at, and no more than the spell reaches; another target, or another
// wound or part to put the heal on, follows from who is aimed at.
export function setCast(id: string, settings: Partial<Omit<CastPlan, 'key'>>): ExplorationUpdater {
  return (t) => {
    const plan = t.exploration.casts[id]
    if (!plan || !isSpellKey(plan.key)) return t
    const reachable = getETCastTargets(t.campaign, id)
    const targets = (settings.targets ?? plan.targets).filter((target, i, all) => reachable.includes(target) && all.indexOf(target) === i).slice(0, getETCastCount(plan.key))
    const retargeted = targets[0] !== plan.targets[0]
    const next: CastPlan = { ...plan, ...settings, targets, ...(retargeted ? { wound: settings.wound ?? null, part: settings.part ?? null } : {}) }
    return { ...t, exploration: { ...t.exploration, casts: { ...t.exploration.casts, [id]: next } } }
  }
}
