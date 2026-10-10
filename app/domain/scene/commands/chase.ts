import type { CampaignCharacter } from '../../types'
import type { Chase, ChaseGroup, SceneState, Updater } from '../types'
import type { ChaseCover, ChaseTier, SkirmishStance } from '../../lists'
import { SURGES } from '../../tables'
import { rollPercent, type Dice } from '../../play/dice'
import { actionSurge } from '../../character/commands/actionSurge'
import { bleed } from '../../character/commands/bleed'
import { getChaseSide, getChaseStartBar, getChaseWays, getFightFirst, getFollowBar, getFollowed, getFollowers, getJoinBar, getJoinRounds, getMembers, getPairGroup, getRunBar, getRunSpeed, getSideSpeed, getSkirmishAP, getSkirmishAPOf, getStanceBar, getUnfollowedStep, isClosingSkirmish, isOutrun, newChase, stepTier, type ChaseWay } from '../rules/chase'
import { getFightBusy } from '../rules/turn'
import { updateCharacter } from './characters'

// combat.tex "Chases": these fight parties run away from everyone else, at
// the tier the table sets.
export function startChase(quarry: string[], tier: ChaseTier): Updater {
  return (state) => getChaseStartBar(state, quarry, tier) ? state : { ...state, chase: newChase(quarry, tier) }
}

function setGroup(state: SceneState, group: string, change: Partial<ChaseGroup>): SceneState {
  const chase = state.chase!
  return { ...state, chase: { ...chase, groups: { ...chase.groups, [group]: { ...chase.groups[group], ...change } } } }
}

// combat.tex "Running": what a run takes from each runner — a dash their
// movement surge; a sustained pace, from one who bleeds, the bleed of "an
// action surge" (each costs the same STA).
function pay(tier: ChaseTier): (c: CampaignCharacter) => CampaignCharacter {
  return tier === 'combat' ? actionSurge('movement') : bleed(SURGES.movement.STA)
}

// combat.tex "Running": the group and whoever follows it run at their
// slowest member's speed and every member pays for it. "A draw does not
// change distance tier" at combat range; at longer ranges "50% chance on a
// draw".
export function runChase(group: string, dice: Dice): Updater {
  return (state) => {
    const chase = state.chase
    if (!chase || getRunBar(state, group)) return state
    const { tier } = chase.groups[group]
    const quarry = getMembers(state, group)
    const pursuers = getFollowers(state, group).flatMap((p) => getMembers(state, p))
    const speeds = Object.fromEntries([...quarry, ...pursuers].map((c) => [c.id, getRunSpeed(c, tier)]))
    const q = getSideSpeed(quarry, tier)
    const p = getSideSpeed(pursuers, tier)
    const coin = q === p && tier !== 'combat' ? rollPercent(dice) : null
    const winner = q > p ? 'quarry' : p > q ? 'pursuers' : coin === null ? null : coin < 50 ? 'quarry' : 'pursuers'
    const paid = [...quarry, ...pursuers].reduce((s: SceneState, c) => updateCharacter(c.id, pay(tier), 'chase run')(s), state)
    return setGroup(paid, group, { run: { tier, speeds, quarry: q, pursuers: p, winner, coin, chosen: winner === null } })
  }
}

// The winner of the group's run says which way the distance goes: a tier
// nearer or farther, and farther from far or horizon is the group getting
// away.
export function chooseChaseWay(group: string, way: ChaseWay): Updater {
  return (state) => {
    const g = state.chase?.groups[group]
    if (!g?.run || !getChaseWays(state, group).includes(way)) return state
    const escaped = isOutrun(g.tier, way)
    return setGroup(state, group, { tier: escaped ? g.tier : stepTier(g.tier, way), escaped, run: { ...g.run, chosen: true } })
  }
}

// The pursuing party goes after another group.
export function followGroup(partyId: string, group: string): Updater {
  return (state) => getFollowBar(state, partyId, group) ? state : { ...state, chase: { ...state.chase!, follows: { ...state.chase!.follows, [partyId]: group } } }
}

// combat.tex "Catching": "a combat or social situation starts" — the group
// is caught and fights it out, or the table lets it run again.
export function setGroupFighting(group: string, fighting: boolean): Updater {
  return (state) => {
    const g = state.chase?.groups[group]
    if (!g || g.escaped || getFightBusy(state)) return state
    return setGroup(state, group, { fighting, tier: fighting ? 'combat' : g.tier, run: null })
  }
}

// combat.tex "Separating the group": the party sets off to join the fight,
// arriving in the rounds its run takes.
export function joinFight(partyId: string, to: string): Updater {
  return (state) => getJoinBar(state, partyId, to) ? state : { ...state, chase: { ...state.chase!, joining: { ...state.chase!.joining, [partyId]: { to, rounds: getJoinRounds(state, partyId) } } } }
}

// combat.tex "Separating the group": a group that splits goes on as two,
// the one splitting off where its group was, and whoever followed the group
// still follows the part that kept its name; a pursuing party that splits
// goes on following the group it followed.
export function splitChaseGroup(state: SceneState, from: string, to: string): Chase | null {
  const chase = state.chase
  if (!chase) return null
  const g = chase.groups[from]
  if (!g) {
    const followed = getFollowed(state, from)
    return followed ? { ...chase, follows: { ...chase.follows, [from]: followed, [to]: followed } } : chase
  }
  const follows = { ...chase.follows, ...Object.fromEntries(getFollowers(state, from).map((p) => [p, from])) }
  return { ...chase, follows, groups: { ...chase.groups, [to]: { ...g, unfollowed: 0, run: null } } }
}

// The chase as the round ends: a skirmish someone approached in brings its
// pair a tier nearer, a group nobody followed drifts away — unless a fight
// was being played out, which the chases wait on — and whoever is on the
// way to a fight is a round nearer it.
export function endChaseRound(state: SceneState): Chase | null {
  const chase = state.chase
  if (!chase) return null
  const paused = getFightFirst(state) !== null
  const groups = Object.fromEntries(Object.entries(chase.groups).map(([id, g]): [string, ChaseGroup] => {
    const held = { ...g, run: null }
    if (paused || g.escaped || g.fighting || !state.parties[id]) return [id, held]
    if (isClosingSkirmish(state, id)) return [id, { ...held, tier: stepTier(g.tier, 'close'), unfollowed: 0 }]
    if (getFollowers(state, id).length > 0) return [id, { ...held, unfollowed: 0 }]
    return [id, { ...held, ...getUnfollowedStep(g), unfollowed: g.unfollowed + 1 }]
  }))
  const arriving = Object.entries(chase.joining).filter(([, j]) => j.rounds <= 1)
  const joining = Object.fromEntries(Object.entries(chase.joining).filter(([, j]) => j.rounds > 1).map(([id, j]) => [id, { ...j, rounds: j.rounds - 1 }]))
  return arriving.reduce((acc: Chase, [id, j]) => (acc.groups[id]
    ? { ...acc, groups: { ...acc.groups, [id]: { ...acc.groups[id], tier: 'combat', fighting: true } } }
    : { ...acc, follows: { ...acc.follows, [id]: j.to } }), { ...chase, groups, joining, stances: {} })
}

// The chase is over and the scene goes on as a fight (combat.tex "Catching":
// "a combat or social situation starts").
export const endChase: Updater = (state) => (!state.chase || getFightBusy(state) ? state : { ...state, chase: null })

// combat.tex "Catching": one of the quarry turns around to face the
// pursuers, or thinks better of it before the table ends the chase.
export function turnAround(id: string): Updater {
  return (state) => {
    const chase = state.chase
    if (!chase || !state.characters[id] || getChaseSide(state, id) !== 'quarry') return state
    const turned = chase.turned.includes(id) ? chase.turned.filter((t) => t !== id) : [...chase.turned, id]
    return { ...state, chase: { ...chase, turned } }
  }
}

// combat.tex "Skirmish": a party shoots or tries to close in. Once it and
// those it skirmishes against have chosen, each member's AP is the
// skirmish's, and whoever approaches spends their movement surge running.
export function chooseStance(partyId: string, stance: SkirmishStance): Updater {
  return (state) => {
    if (!state.chase || getStanceBar(state, partyId)) return state
    const chosen = { ...state, chase: { ...state.chase, stances: { ...state.chase.stances, [partyId]: stance } } }
    const group = getPairGroup(state, partyId)!
    const pair = [group, ...getFollowers(state, group)]
    const budgets = pair.flatMap((p) => {
      const AP = getSkirmishAP(chosen, p)
      return AP !== null && getSkirmishAP(state, p) === null ? [{ p, AP }] : []
    })
    return budgets.reduce((acc: SceneState, { p, AP }) => getMembers(acc, p).reduce((inner: SceneState, c) => updateCharacter(c.id, (ch) => {
      const budgeted = { ...ch, resources: { ...ch.resources, AP: getSkirmishAPOf(ch, AP) } }
      return chosen.chase.stances[p] === 'approach' ? actionSurge('movement')(budgeted) : budgeted
    }, 'skirmish')(inner), acc), chosen)
  }
}

// combat.tex "Cover": the table says who has cover and whether they stay in
// it, or takes it away.
export function setChaseCover(id: string, cover: ChaseCover | null): Updater {
  return (state) => {
    const chase = state.chase
    if (!chase || !state.characters[id]) return state
    const { [id]: _was, ...rest } = chase.cover
    return { ...state, chase: { ...chase, cover: cover ? { ...rest, [id]: cover } : rest } }
  }
}
