import type { CampaignCharacter } from '../../types'
import type { Chase, ChaseDeclaration, ChaseLink, ChaseRoll, ChaseRun, SceneResume, SceneState, Updater } from '../types'
import type { ChaseCover, ChaseRole, ChaseTier, ChaseWay, CrossingSkill } from '../../lists'
import { SKIRMISH_APPROACH_AP, SKIRMISH_SHOOT_AP, SURGES } from '../../tables'
import { rollPercent } from '../../play/dice'
import { toRoll, type Test } from '../../play/test'
import type { Caller, Throw } from '../../play/calls'
import { calling } from './calling'
import { actionSurge, endSurge } from '../../character/commands/actionSurge'
import { bleed } from '../../character/commands/bleed'
import { canTurnAround, getActiveLinks, getChaseParties, getChaseStartBar, getChaseWithoutDead, getConfirmBar, getCrossBar, getCrossingSkill, getDeclareBar, getEnemyChasers, getFightBar, getFightFirst, getFollowBar, getFoundTier, getHidingTest, getJoinBar, getLink, getMembers, getMergeBar, getObstacleOwner, getPacingLinks, getPartyTierBetween, getPutBackBar, getRechained, getResolveBar, getRunSeconds, getRunSpeed, getScoutSkill, getSideSpeed, getSkirmishAPOf, getTeam, getWant, isDisconnected, isEnemyLink, isHidingLink, isMeeting, isOutrun, isSkirmishLink, newChase, stepTier } from '../rules/chase'
import { getFightBusy } from '../rules/turn'
import { updateCharacter } from './characters'
import { dropEmptyFightParties } from './parties'

// combat.tex "Chases": these fight parties run away from everyone else, at
// the tier the table sets.
export function startChase(quarry: string[], tier: ChaseTier): Updater {
  return (state) => getChaseStartBar(state, quarry, tier) ? state : { ...state, chase: newChase(state, quarry, tier) }
}

function withChase(state: SceneState, change: Partial<Chase>): SceneState {
  return { ...state, chase: { ...state.chase!, ...change } }
}

const without = (list: string[], id: string) => list.filter((x) => x !== id)

// combat.tex "Chase actions": the party says what it does this round, in the
// chain's order; it may change its mind until it confirms ("Then quarry can
// choose to change their strategy").
export function declareChase(partyId: string, declaration: ChaseDeclaration): Updater {
  return (state) => getDeclareBar(state, partyId, declaration) ? state : withChase(state, { declarations: { ...state.chase!.declarations, [partyId]: declaration } })
}

// combat.tex "Chain order of running": "Then everyone confirms their actions
// from tail to head of the chain", and what a party confirmed is final.
export function confirmChase(partyId: string): Updater {
  return (state) => getConfirmBar(state, partyId) ? state : withChase(state, { confirmed: [...state.chase!.confirmed, partyId] })
}

// combat.tex "Running": "Both sides use their movement surge to sprint" —
// the surge spent and its AP run off in the sprint, none left over for the
// round.
function sprint(c: CampaignCharacter): CampaignCharacter {
  return endSurge(actionSurge('movement')(c))
}

// combat.tex "Running": what a run takes from each runner — a dash their
// movement surge; a sustained pace, from one who bleeds, the bleed of "an
// action surge" (each costs the same STA).
function pay(tier: ChaseTier): (c: CampaignCharacter) => CampaignCharacter {
  return tier === 'combat' ? sprint : bleed(SURGES.movement.STA)
}

// combat.tex "Skirmish": the round's AP traded for the skirmish's, the mover
// sprinting ("must spend a movement surge for running"), the shooter facing
// one spending their focus surge.
function budget(AP: number, then: ((c: CampaignCharacter) => CampaignCharacter) | null): (c: CampaignCharacter) => CampaignCharacter {
  return (c) => {
    const budgeted = { ...c, resources: { ...c.resources, AP: getSkirmishAPOf(c, AP) } }
    return then ? then(budgeted) : budgeted
  }
}

function forEachMember(state: SceneState, partyId: string, update: (c: CampaignCharacter) => CampaignCharacter, why: string): SceneState {
  return getMembers(state, partyId).reduce((s: SceneState, c) => updateCharacter(c.id, update, why)(s), state)
}

// combat.tex "Hiding": "Whatever happens, the chase turns into a stealth
// situation" — at far or horizon "the chase is over" for whoever hid; at
// shooting range the team's hiders roll once ("Hiding at shooting
// distances"): "On a stealth miss or graze, the pursuers find the lowest
// stealth character and anyone that is with them", whose chasers close in a
// tier — caught only once at combat range — and whose hiding place is lost;
// the rest of the group stay chased and decide again next round (the table's
// rulings); "On a hit or crit, the pursuers follow some wrong track or give
// up".
// The test a party makes in the chase, thrown by one of its members.
function partyTest(caller: Caller, state: SceneState, id: string, partyId: string, label: string, test: Test) {
  return caller.test({ id, roller: getMembers(state, partyId)[0]?.id ?? partyId, label, test })
}

function hide(state: SceneState, caller: Caller): SceneState {
  const chase = state.chase!
  const hiders = getChaseParties(state).filter((p) => chase.declarations[p]?.move === 'hide' && getEnemyChasers(state, p).length > 0)
  const close = (p: string) => getEnemyChasers(state, p).some((c) => getLink(state, c)!.tier === 'shooting')
  const lose = (s: SceneState, parties: string[]): SceneState => {
    const links = Object.fromEntries(Object.entries(s.chase!.links).filter(([from, l]) => !(parties.includes(l.chases) && isEnemyLink(s, from))))
    return withChase(s, { links })
  }
  const away = lose(state, hiders.filter((p) => !close(p)))
  const groups = (['quarry', 'pursuers'] as const).map((team) => hiders.filter((p) => close(p) && getTeam(chase, p) === team)).filter((g) => g.length > 0)
  return groups.reduce((s: SceneState, group) => {
    const modifier = Math.min(...group.map((p) => chase.declarations[p].hideModifier))
    const test = getHidingTest(s, group, modifier)
    if (!test) return s
    const result = partyTest(caller, s, `hide:${group.join(',')}`, group[0], 'hiding', { skill: test.skill, DL: test.DL, explodes: false, scale: 'degrees' })
    if (!result) return s
    const hidden = result.degree === 'hit' || result.degree === 'critical'
    const roll: ChaseRoll = { kind: 'hide', parties: group, found: hidden ? null : test.worst, roll: toRoll(result) }
    const logged = withChase(s, { rolls: [...s.chase!.rolls, roll] })
    if (hidden) return lose(logged, group)
    const links = Object.fromEntries(Object.entries(logged.chase!.links).map(([from, l]): [string, ChaseLink] => [from, l.chases === test.worst && isEnemyLink(logged, from) ? { ...l, tier: stepTier(l.tier, 'close') } : l]))
    return withChase(logged, { links, features: dropKey(logged.chase!.features, test.worst) })
  }, away)
}

// combat.tex "Catching": "a combat or social situation starts" — the party
// fights whoever was chasing it, brought to combat range.
function catchParty(state: SceneState, partyId: string): SceneState {
  const chase = state.chase!
  const links = Object.fromEntries(Object.entries(chase.links).map(([from, l]): [string, ChaseLink] => [from, l.chases === partyId && isEnemyLink(state, from) ? { ...l, tier: 'combat' } : l]))
  return withChase(state, { links, fighting: chase.fighting.includes(partyId) ? chase.fighting : [...chase.fighting, partyId] })
}

// The way a run takes the distance between the two ends: where both want the
// same way it goes that way, where one stands it goes the mover's way, and
// where they pull opposite ways the faster decides, a draw by a coin at every
// range (the table's ruling, over "A draw does not change distance tier").
function runLink(state: SceneState, from: string, caller: Caller): ChaseRun {
  const chase = state.chase!
  const link = getLink(state, from)!
  const { tier } = link
  const want = (p: string, role: ChaseRole) => getWant(chase.declarations[p]?.move, role)
  const chaserWay = want(from, 'chaser')
  const chasedWay = want(link.chases, 'chased')
  const chasers = getMembers(state, from)
  const chased = getMembers(state, link.chases)
  const speeds = Object.fromEntries([...chasers, ...chased].map((c) => [c.id, getRunSpeed(c, tier)]))
  const base = { tier, speeds, chaser: getSideSpeed(chasers, tier), chased: getSideSpeed(chased, tier), skirmish: isSkirmishLink(state, from), contest: false, winner: null, coin: null }
  if (!chaserWay || !chasedWay || chaserWay === chasedWay) return { ...base, way: chaserWay ?? chasedWay }
  const coin = base.chaser === base.chased ? rollPercent(caller.dice) : null
  const winner: ChaseRole = base.chaser > base.chased ? 'chaser' : base.chased > base.chaser ? 'chased' : coin! < 50 ? 'chaser' : 'chased'
  return { ...base, contest: true, winner, coin, way: winner === 'chaser' ? chaserWay : chasedWay }
}

// The distance goes the run's way: a tier nearer or farther, and farther
// from far is the link broken, the chased getting away.
function applyWay(links: Record<string, ChaseLink>, from: string, way: ChaseWay | null): Record<string, ChaseLink> {
  const link = links[from]
  if (!link || !way) return links
  if (isOutrun(link.tier, way)) {
    const { [from]: _gone, ...rest } = links
    return rest
  }
  return { ...links, [from]: { ...link, tier: stepTier(link.tier, way) } }
}

// combat.tex "Inverting chase": "If the quary decides to run towards the
// pursuers, and the pursuers decide to run away, they switch roles next
// round" — where the chased party is chasing nobody else.
function invert(state: SceneState, links: Record<string, ChaseLink>, from: string): Record<string, ChaseLink> {
  const link = links[from]
  const declarations = state.chase!.declarations
  if (!link || links[link.chases] || declarations[from]?.move !== 'reverse' || declarations[link.chases]?.move !== 'reverse') return links
  const { [from]: was, ...rest } = links
  return { ...rest, [was.chases]: { chases: from, tier: was.tier, run: was.run } }
}

// combat.tex "Running", "Skirmish": every party that ran pays for it once —
// a skirmish's mover and a dash with their movement surge, a sustained pace
// in bleeding — and a skirmish's shooters have their 18 AP, spending their
// focus surge where someone moved against them.
function payRound(state: SceneState, runs: [string, ChaseRun][]): SceneState {
  const chase = state.chase!
  const parties = [...new Set(runs.flatMap(([from]) => [from, state.chase!.links[from]?.chases ?? '']))].filter((p) => p)
  const endsOf = (p: string) => runs.filter(([from]) => from === p || chase.links[from]?.chases === p)
  const moved = (p: string) => ['run', 'reverse'].includes(chase.declarations[p]?.move ?? '')
  return parties.reduce((s: SceneState, p) => {
    const mine = endsOf(p)
    const skirmish = mine.filter(([, r]) => r.skirmish)
    if (moved(p)) {
      if (skirmish.length) return forEachMember(s, p, budget(SKIRMISH_APPROACH_AP, sprint), 'skirmish')
      const pacing = getPacingLinks(state, mine.map(([from]) => from))
      const dash = mine.some(([from, r]) => pacing.includes(from) && r.tier === 'combat')
      return forEachMember(s, p, pay(dash ? 'combat' : 'shooting'), 'chase run')
    }
    if (skirmish.length && chase.declarations[p]?.move === 'shoot') {
      const facesMover = skirmish.some(([from]) => moved(from === p ? chase.links[from].chases : from))
      return forEachMember(s, p, budget(SKIRMISH_SHOOT_AP, facesMover ? actionSurge('focus') : null), 'skirmish')
    }
    return s
  }, state)
}

// combat.tex "Scouting": a party that scouted while running finds the place
// it looked for — "A crit arrives at the place in the following round, a hit
// puts it in shooting distance, and a graze or miss fails".
function scout(state: SceneState, caller: Caller): SceneState {
  const chase = state.chase!
  return getChaseParties(state).reduce((s: SceneState, p) => {
    const looking = chase.declarations[p]?.scout
    const skill = getScoutSkill(s, p)
    if (!looking || skill === null || s.chase!.fighting.includes(p)) return s
    const result = partyTest(caller, s, `scout:${p}`, p, 'scouting', { skill, DL: looking.DL, explodes: false, scale: 'degrees' })
    if (!result) return s
    const tier = getFoundTier(result.degree)
    const rolls = [...s.chase!.rolls, { kind: 'scout' as const, parties: [p], found: null, roll: toRoll(result) }]
    const features = tier ? { ...s.chase!.features, [p]: { what: looking.what, tier, obstacle: looking.obstacle, reached: false } } : s.chase!.features
    return withChase(s, { rolls, features })
  }, state)
}

// The round's chase, once everyone has declared: the hiders hide, every link
// that runs is run — a skirmish's way waits for the round's end — whoever
// ran pays for it, enemies running at each other at combat range meet in a
// fight, and whoever scouted looks.
export function resolveChase(thrown: Throw): Updater {
  return calling({ kind: 'resolveChase' }, thrown, (caller) => (state) => {
    if (getResolveBar(state)) return state
    const active = getActiveLinks(state)
    const hidden = hide(state, caller)
    if (caller.waiting()) return state
    const live = active.filter((p) => !isHidingLink(state, p) && getActiveLinks(hidden).includes(p))
    const runs: [string, ChaseRun][] = live.map((p) => [p, runLink(hidden, p, caller)])
    const recorded = runs.reduce((links, [p, run]) => ({ ...links, [p]: { ...links[p], run } }), hidden.chase!.links)
    const moved = runs.reduce((links, [p, run]) => run.skirmish ? links : invert(state, applyWay(links, p, run.way), p), recorded)
    const paid = payRound(withChase(hidden, { links: recorded }), runs)
    const pacing = getPacingLinks(hidden, runs.map(([p]) => p))
    const seconds = getRunSeconds(runs.filter(([p]) => pacing.includes(p)).map(([, r]) => r))
    const met = runs.filter(([p]) => isMeeting(hidden, p)).map(([p]) => hidden.chase!.links[p].chases)
    const caught = met.reduce(catchParty, withChase(paid, { links: moved, resolved: true, seconds }))
    return scout(caught, caller)
  })
}

// The chase's command the scene's dice were called for by, carried on once
// they are in; null for any other, so that a scene with no chase is not
// reached.
export function resumeChase(resume: SceneResume, thrown: Throw): Updater | null {
  if (resume.kind === 'resolveChase') return resolveChase(thrown)
  if (resume.kind === 'cross') return crossObstacle(resume.partyId, resume.skill, resume.DL, thrown)
  return null
}

// The pursuing party goes after another party, at the tier the chain puts
// between them.
export function followParty(partyId: string, target: string): Updater {
  return (state) => {
    if (getFollowBar(state, partyId, target)) return state
    const tier = getPartyTierBetween(state, partyId, target) ?? 'combat'
    return withChase(state, { links: { ...state.chase!.links, [partyId]: { chases: target, tier, run: null } }, declarations: dropKey(state.chase!.declarations, partyId), confirmed: without(state.chase!.confirmed, partyId) })
  }
}

function dropKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _gone, ...rest } = record
  return rest
}

// combat.tex "Obstacle": a party that cannot or will not follow lets the one
// it chases go.
export function giveUp(partyId: string): Updater {
  return (state) => (getLink(state, partyId) && !getFightBusy(state) ? withChase(state, { links: dropKey(state.chase!.links, partyId) }) : state)
}

// combat.tex "Disconnected party": the GM places the party back into the
// chain, chasing someone at the tier the table says.
export function putBack(partyId: string, target: string, tier: ChaseTier): Updater {
  return (state) => getPutBackBar(state, partyId, target) ? state : withChase(state, { out: without(state.chase!.out, partyId), links: { ...state.chase!.links, [partyId]: { chases: target, tier, run: null } } })
}

// combat.tex "Catching": "a combat or social situation starts" — the party
// is caught and fights it out, or the table lets it run again.
export function setPartyFighting(partyId: string, fighting: boolean): Updater {
  return (state) => {
    if (getFightBar(state, partyId, fighting)) return state
    return fighting ? catchParty(state, partyId) : withChase(state, { fighting: without(state.chase!.fighting, partyId) })
  }
}

// The party arrives at the fight: an enemy of the caught party chases it at
// combat range; one of its team fights beside it.
function arrive(state: SceneState, partyId: string, to: string): SceneState {
  const chase = state.chase!
  const enemy = getTeam(chase, partyId) !== getTeam(chase, to)
  return withChase(state, {
    links: { ...chase.links, [partyId]: { chases: to, tier: 'combat', run: null } },
    fighting: enemy || chase.fighting.includes(partyId) ? chase.fighting : [...chase.fighting, partyId],
    joining: dropKey(chase.joining, partyId),
  })
}

// combat.tex "Combat with split group": the party sets off to join the
// fight — at once from combat range; from shooting range it "must spend one
// full round to arrive at the fight".
export function joinFight(partyId: string, to: string): Updater {
  return (state) => {
    if (getJoinBar(state, partyId, to)) return state
    if (getPartyTierBetween(state, partyId, to) === 'combat') return arrive(state, partyId, to)
    return withChase(state, { joining: { ...state.chase!.joining, [partyId]: to } })
  }
}

// What a party leaves behind in the chase once it is gone from the fight.
function forget(chase: Chase, partyId: string): Chase {
  return {
    ...chase,
    runaways: without(chase.runaways, partyId),
    links: dropKey(chase.links, partyId),
    out: without(chase.out, partyId),
    fighting: without(chase.fighting, partyId),
    joining: dropKey(chase.joining, partyId),
    declarations: dropKey(chase.declarations, partyId),
    confirmed: without(chase.confirmed, partyId),
    features: dropKey(chase.features, partyId),
  }
}

// The table's ruling: a party left behind merges back into the party of its
// team it chases, and whoever chased it chases them.
export function mergeBack(partyId: string): Updater {
  return (state) => {
    if (getMergeBar(state, partyId)) return state
    const into = getLink(state, partyId)!.chases
    const chase = state.chase!
    const partyOf = Object.fromEntries(Object.entries(state.partyOf).map(([id, p]) => [id, p === partyId ? into : p]))
    return dropEmptyFightParties({ ...state, partyOf, chase: forget({ ...chase, links: getRechained(chase.links, partyId) }, partyId) }, [partyId])
  }
}

// combat.tex "Obstacle": the party tries to cross the obstacle in front of
// it, at the DL the table sets, on its lowest member's skill.
export function crossObstacle(partyId: string, skill: CrossingSkill, DL: number, thrown: Throw): Updater {
  return calling({ kind: 'cross', partyId, skill, DL }, thrown, (caller) => (state) => {
    const value = getCrossingSkill(state, partyId, skill)
    if (getCrossBar(state, partyId) || value === null) return state
    const result = partyTest(caller, state, `cross:${partyId}`, partyId, `crossing (${skill})`, { skill: value, DL, explodes: false, scale: 'degrees' })
    if (!result) return state
    const crossed = result.degree === 'hit' || result.degree === 'critical'
    const owner = getObstacleOwner(state, partyId)!
    const rolls = [...state.chase!.rolls, { kind: 'cross' as const, parties: [partyId], found: null, roll: toRoll(result) }]
    const features = crossed && owner === partyId ? dropKey(state.chase!.features, partyId) : state.chase!.features
    return withChase(state, { rolls, features })
  })
}

// combat.tex "Scouting": a place the party ran towards this round is a tier
// nearer, and reached once it was within combat range.
function approachFeatures(chase: Chase): Chase['features'] {
  return Object.fromEntries(Object.entries(chase.features).map(([p, f]) => {
    if (f.reached || chase.declarations[p]?.move !== 'run') return [p, f]
    return [p, f.tier === 'combat' ? { ...f, reached: true } : { ...f, tier: stepTier(f.tier, 'close') }]
  }))
}

// The chase as the round ends: unless a fight was being played out, which
// the chases wait on, the skirmishes' ways land and the places run towards
// come nearer; whoever was on the way to a fight arrives; the round's
// declarations, runs and tests are cleared; and whoever is left disconnected
// is out of the chase.
export function endChaseRound(state: SceneState): Chase | null {
  const chase = state.chase
  if (!chase) return null
  const ran = chase.resolved && getFightFirst(state) === null
  const settled = ran ? Object.entries(chase.links).reduce((links, [from, l]) => (l.run?.skirmish ? applyWay(links, from, l.run.way) : links), chase.links) : chase.links
  const links = Object.fromEntries(Object.entries(settled).map(([from, l]) => [from, { ...l, run: null }]))
  const features = ran ? approachFeatures(chase) : chase.features
  const arrived = Object.entries(chase.joining).reduce((s: SceneState, [p, to]) => arrive(s, p, to), withChase(state, { links, features }))
  const cleared = withChase(arrived, { declarations: {}, confirmed: [], resolved: false, seconds: null, rolls: [] })
  const out = getChaseParties(cleared).filter((p) => isDisconnected(cleared, p) && !isHeldOn(cleared.chase!, p))
  return { ...cleared.chase!, out: [...cleared.chase!.out, ...out] }
}

// The chase as the round change ends, once bleeding and burning have done
// their work: a party with nobody left alive leaves it.
export function endChaseRoundChange(state: SceneState): Chase | null {
  return state.chase && getChaseWithoutDead(state, state.chase)
}

function isHeldOn(chase: Chase, partyId: string): boolean {
  return chase.fighting.includes(partyId) || !!chase.joining[partyId]
}

// The chase is over and the scene goes on as a fight (combat.tex "Catching":
// "a combat or social situation starts").
export const endChase: Updater = (state) => (!state.chase || getFightBusy(state) ? state : { ...state, chase: null })

// combat.tex "Catching": one of a chased party turns around to face the
// chasers, or thinks better of it before the table ends the chase.
export function turnAround(id: string): Updater {
  return (state) => {
    const chase = state.chase
    if (!chase || !state.characters[id] || (!canTurnAround(state, id) && !chase.turned.includes(id))) return state
    const turned = chase.turned.includes(id) ? without(chase.turned, id) : [...chase.turned, id]
    return withChase(state, { turned })
  }
}

// combat.tex "Cover": the table says who has cover and whether they stay in
// it, or takes it away.
export function setChaseCover(id: string, cover: ChaseCover | null): Updater {
  return (state) => {
    const chase = state.chase
    if (!chase || !state.characters[id]) return state
    const rest = dropKey(chase.cover, id)
    return withChase(state, { cover: cover ? { ...rest, [id]: cover } : rest })
  }
}

