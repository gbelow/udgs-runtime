import type { CampaignCharacter } from '../../types'
import type { Chase, ChaseDeclaration, ChaseLink, SceneState } from '../types'
import type { Term } from '../../character/rules/terms'
import { AFFLICTIONS, CHASE_PARTIAL_COVER_REFLEX, CHASE_ROUND_SECONDS, CHASE_TIER_METRES, ROUND_AP, ROUND_SECONDS, SKIRMISH_APPROACH_AP, SKIRMISH_SECONDS, SKIRMISH_SHOOT_AP, SURGES } from '../../tables'
import { CHASE_TIERS, SHOT_RANGES, type ChaseMove, type ChaseRole, type ChaseSide, type ChaseTier, type ChaseWay, type CrossingSkill } from '../../lists'
import { getAfflictions, isDead } from '../../character/rules/afflictions'
import { getAGI, getSTA } from '../../character/rules/characteristics'
import { getRunMovement } from '../../character/rules/movement'
import { getBalance, getClimb, getDetection, getStealth, getSwim } from '../../character/rules/skills'
import { getSituationalAfflictions } from './situational'
import { getFightName } from './fighters'
import { getFightBusy } from './turn'
import { getRoundPhase } from './roundChange'

// Everyone in the party still alive.
export function getMembers(state: SceneState, partyId: string): CampaignCharacter[] {
  return Object.values(state.characters).filter((c) => !isDead(c) && state.partyOf[c.id] === partyId)
}

// combat.tex "Running": at combat range a dash, "Whoever has the highest AGI
// x running speed wins"; at longer ranges a sustained pace, "The running
// speed is STA + AGI" — the STA attribute, every penalty on both counted.
export function getRunSpeed(c: CampaignCharacter, tier: ChaseTier): number {
  return tier === 'combat' ? getAGI(c) * getRunMovement(c) : getSTA(c) + getAGI(c)
}

// combat.tex "Group chases": "Every party runs at the speed of its slowest
// integrant".
export function getSideSpeed(runners: CampaignCharacter[], tier: ChaseTier): number {
  return runners.length ? Math.min(...runners.map((c) => getRunSpeed(c, tier))) : 0
}

function getPartySpeed(state: SceneState, partyId: string, tier: ChaseTier): number {
  return getSideSpeed(getMembers(state, partyId), tier)
}

// combat.tex "Chases": the team that ran away first, and the one that gave
// chase — a party made in the fight gives chase.
export function getTeam(chase: Chase, partyId: string): ChaseSide {
  return chase.runaways.includes(partyId) ? 'quarry' : 'pursuers'
}

// combat.tex "Group chases": the chain a chase starts as. The parties
// running away run at their slowest member's speed, so "The slower member of
// a split party starts chasing the faster ones": each runs after the next
// faster, side by side, and everyone giving chase chases the slowest, at the
// tier the table sets ("Approach": "The weapon range will decide at what
// distance both teams start").
export function newChase(state: SceneState, quarry: string[], tier: ChaseTier): Chase {
  const runaways = quarry.filter((p) => state.parties[p])
  const bySpeed = [...runaways].sort((a, b) => getPartySpeed(state, a, tier) - getPartySpeed(state, b, tier))
  const pursuers = Object.keys(state.parties).filter((p) => !runaways.includes(p))
  const links: Record<string, ChaseLink> = Object.fromEntries([
    ...bySpeed.slice(0, -1).map((p, i) => [p, { chases: bySpeed[i + 1], tier: 'combat' as ChaseTier, run: null }]),
    ...(bySpeed.length ? pursuers.map((p) => [p, { chases: bySpeed[0], tier, run: null }]) : []),
  ])
  return { runaways, links, out: [], fighting: [], joining: {}, declarations: {}, resolved: false, seconds: null, rolls: [], features: {}, turned: [], cover: {} }
}

// The parties still in the chase.
export function getChaseParties(state: SceneState): string[] {
  const chase = state.chase
  return chase ? Object.keys(state.parties).filter((p) => !chase.out.includes(p)) : []
}

// The party's link — whoever it chases, and how far — while both ends are
// still in the chase.
export function getLink(state: SceneState, partyId: string): ChaseLink | null {
  const chase = state.chase
  const link = chase?.links[partyId]
  if (!chase || !link || !state.parties[partyId] || !state.parties[link.chases]) return null
  return chase.out.includes(partyId) || chase.out.includes(link.chases) ? null : link
}

// The parties chasing this one.
export function getChasers(state: SceneState, partyId: string): string[] {
  return getChaseParties(state).filter((p) => getLink(state, p)?.chases === partyId)
}

// Whether the link from the party joins two teams.
export function isEnemyLink(state: SceneState, from: string): boolean {
  const link = getLink(state, from)
  return !!link && getTeam(state.chase!, from) !== getTeam(state.chase!, link.chases)
}

// The enemies chasing the party.
export function getEnemyChasers(state: SceneState, partyId: string): string[] {
  return getChasers(state, partyId).filter((p) => isEnemyLink(state, p))
}

// combat.tex "Disconnected party": "Whoever is not being chased by anyone or
// pursuing anyone is out of the chase".
export function isDisconnected(state: SceneState, partyId: string): boolean {
  return !getLink(state, partyId) && getChasers(state, partyId).length === 0
}

// A party sitting the run out: caught and fighting, or on its way to a fight.
export function isHeld(state: SceneState, partyId: string): boolean {
  const chase = state.chase
  return !!chase && (chase.fighting.includes(partyId) || !!chase.joining[partyId])
}

// The tier a link stands at this round: the one it was run at, once run.
function getRoundTier(link: ChaseLink): ChaseTier {
  return link.run?.tier ?? link.tier
}

// A link both of whose ends run this round.
function isLinkLive(state: SceneState, from: string): boolean {
  const link = getLink(state, from)
  return !!link && !isHeld(state, from) && !isHeld(state, link.chases)
}

// combat.tex "Chain order of running": "If there is anyone at combat range,
// characters dont do anything at far range, just keep the distance" — an
// enemy within combat range, not a party beside its own team.
export function isFrozen(state: SceneState, from: string): boolean {
  const link = getLink(state, from)
  if (!link || getRoundTier(link) !== 'far') return false
  return getChaseParties(state).some((p) => isLinkLive(state, p) && isEnemyLink(state, p) && getRoundTier(getLink(state, p)!) === 'combat')
}

// The links run this round.
export function getActiveLinks(state: SceneState): string[] {
  return getChaseParties(state).filter((p) => isLinkLive(state, p) && !isFrozen(state, p))
}

// The parties that declare what they do this round: the ends of the links
// that run.
export function getDeclarers(state: SceneState): string[] {
  const ends = new Set(getActiveLinks(state).flatMap((p) => [p, getLink(state, p)!.chases]))
  return getChaseParties(state).filter((p) => ends.has(p))
}

// combat.tex "Chain order of running": "the head of the chain is always the
// first to decide their action, then its pursuer decides what to do, and so
// on until the end of the chain" — the parties in that order, head first.
export function getDeclareOrder(state: SceneState): string[] {
  const depth = (p: string): number => {
    const seen = new Set<string>()
    let n = 0
    for (let at = getLink(state, p); at && !seen.has(at.chases); at = getLink(state, at.chases)) {
      seen.add(at.chases)
      n++
    }
    return n
  }
  return getDeclarers(state).map((p) => ({ p, d: depth(p) })).sort((a, b) => a.d - b.d).map(({ p }) => p)
}

// The party's ancestors in the chain, nearest first, each with the farthest
// tier between it and the party.
function getAncestry(state: SceneState, partyId: string): Map<string, ChaseTier> {
  const found = new Map<string, ChaseTier>([[partyId, 'combat']])
  let worst: ChaseTier = 'combat'
  for (let at = getLink(state, partyId); at && !found.has(at.chases); at = getLink(state, at.chases)) {
    worst = CHASE_TIERS[Math.max(CHASE_TIERS.indexOf(worst), CHASE_TIERS.indexOf(at.tier))]
    found.set(at.chases, worst)
  }
  return found
}

// The table's ruling for parties apart in the chain: the farthest tier on
// the chain between them. Parties in different chains, or out of the chase,
// are as far as the horizon; null within a party.
export function getPartyTierBetween(state: SceneState, a: string, b: string): ChaseTier | null {
  if (a === b) return null
  const fromA = getAncestry(state, a)
  const fromB = getAncestry(state, b)
  const meet = [...fromA.keys()].find((p) => fromB.has(p))
  if (meet === undefined) return 'horizon'
  return CHASE_TIERS[Math.max(CHASE_TIERS.indexOf(fromA.get(meet)!), CHASE_TIERS.indexOf(fromB.get(meet)!))]
}

// The tier between two characters in different parties of a chase; null
// within a party or with no chase.
export function getChaseTierBetween(state: SceneState, a: string, b: string): ChaseTier | null {
  const pa = state.partyOf[a]
  const pb = state.partyOf[b]
  if (!state.chase || pa === undefined || pb === undefined) return null
  return getPartyTierBetween(state, pa, pb)
}

// The metres between two characters of a chase past combat range; null for
// everyone else, whose distance is the board's, if any.
export function getChaseDistance(state: SceneState, a: string, b: string): number | null {
  const tier = getChaseTierBetween(state, a, b)
  return tier && tier !== 'combat' ? CHASE_TIER_METRES[tier] : null
}

// combat.tex "Approach": a shot's range names a tier, and reaches a side as
// far as that tier.
export function reachesTier(range: string, tier: ChaseTier): boolean {
  return (SHOT_RANGES as readonly string[]).includes(range) && CHASE_TIERS.indexOf(range as ChaseTier) >= CHASE_TIERS.indexOf(tier)
}

// combat.tex "Catching": "The quarry is caught when one of its members does
// not have STA to run, when they decide to turn around and face the pursuer,
// or when it ends a round with any mobility affliction while in combat range"
// — lacking STA only in combat range too, where running is a dash on the
// movement surge's STA. Each member of a party enemies chase who would end
// its run, and why.
export function getCaught(state: SceneState, partyId: string): { id: string; reason: string }[] {
  const chase = state.chase
  if (!chase || isHeld(state, partyId)) return []
  const chasers = getEnemyChasers(state, partyId).filter((p) => !isHeld(state, p))
  if (chasers.length === 0) return []
  const close = chasers.some((p) => getLink(state, p)!.tier === 'combat')
  return getMembers(state, partyId).flatMap((c) => {
    const name = getFightName(state, c.id)
    if (chase.turned.includes(c.id)) return [{ id: c.id, reason: `${name} turned around` }]
    if (!close) return []
    if (c.resources.STA < SURGES.movement.STA) return [{ id: c.id, reason: `${name} has no STA to run` }]
    const hobbled = getAfflictions(c, getSituationalAfflictions(state, c.id)).find((k) => AFFLICTIONS[k].category === 'mobility')
    return hobbled ? [{ id: c.id, reason: `${name} is ${hobbled}` }] : []
  })
}

// combat.tex "Escape": "The chase starts when everyone in a party decides to
// run away [...]. It always starts at the beginning of a new round. Any
// character that cannot run for whatever reason at the beginning of the
// round will prevent the chase from beginning" — whoever the chase would
// catch at once. In a fight under way, its round change is where, once the
// morale tests are made and the limit stress actions taken.
export function getChaseStartBar(state: SceneState, quarry: string[], tier: ChaseTier): string | null {
  if (state.chase) return 'a chase is under way'
  const busy = getFightBusy(state)
  if (busy) return busy
  if (state.round > 0 && getRoundPhase(state) !== 'chase') return 'a chase starts at the round change, after the morale tests'
  const started = { ...state, chase: newChase(state, quarry, tier) }
  const sides = Object.keys(state.parties).map((p) => getMembers(state, p).length > 0 ? getTeam(started.chase, p) : null)
  if (!sides.includes('quarry') || !sides.includes('pursuers')) return 'a chase needs someone on each side'
  const caught = quarry.flatMap((g) => getCaught(started, g))
  return caught.length ? `cannot run: ${caught.map((c) => c.reason).join(', ')}` : null
}

const partyName = (state: SceneState, id: string) => state.parties[id]?.name || 'a party'

// combat.tex "Escape": "finish the fight, and then start the chase" — while
// a party is caught and fighting, the fight is played out before anyone runs.
export function getFightFirst(state: SceneState): string | null {
  const fighting = state.chase?.fighting.filter((p) => state.parties[p] && getMembers(state, p).length > 0) ?? []
  return fighting.length ? `${fighting.map((p) => partyName(state, p)).join(', ')} fighting first` : null
}

// The party's enemy links that run this round: the one it chases and the
// ones chasing it.
function getEnemyLinksOf(state: SceneState, partyId: string): string[] {
  return getActiveLinks(state).filter((p) => isEnemyLink(state, p) && (p === partyId || getLink(state, p)!.chases === partyId))
}

// combat.tex "Skirmish": "This stage can only happen at Shooting distance or
// far distance."
function isSkirmishTier(tier: ChaseTier): boolean {
  return tier === 'shooting' || tier === 'far'
}

// Why the party cannot declare the move: the round is under way or resolved,
// it does not run this round, the party it chases has not declared yet
// (combat.tex "Chain order of running"), or the move is not open to it — a
// skirmish at shooting or far range against an enemy, hiding only in a
// hiding place the party scouted and reached ("Scouting": "a place to hide")
// and past combat range from every enemy chasing it ("Hiding: can be done at
// any distance greater than Combat"), scouting only while running away from
// enemies ("Only the fugitives can do this").
export function getDeclareBar(state: SceneState, partyId: string, declaration: ChaseDeclaration): string | null {
  const chase = state.chase
  if (!chase) return 'there is no chase'
  if (state.round === 0) return 'press start combat to begin the first round'
  if (chase.resolved) return 'the round has been resolved'
  const first = getFightFirst(state)
  if (first) return first
  if (state.turnsTaken.length > 0) return 'the round is under way'
  if (!getDeclarers(state).includes(partyId)) return 'they sit this round out'
  const ahead = getLink(state, partyId)?.chases
  if (ahead && getDeclarers(state).includes(ahead) && !chase.declarations[ahead]) return `${partyName(state, ahead)} declares first`
  const { move, scout } = declaration
  if (move === 'shoot' && !getEnemyLinksOf(state, partyId).some((p) => isSkirmishTier(getLink(state, p)!.tier))) return 'a skirmish is fought only against an enemy at shooting or far range'
  if (move === 'hide') {
    const place = chase.features[partyId]
    if (!place?.reached || place.obstacle) return 'no hiding place reached: scout for one while running'
    const chasers = getEnemyChasers(state, partyId).filter((p) => !isHeld(state, p))
    if (chasers.length === 0) return 'nobody is after them'
    if (chasers.some((p) => getLink(state, p)!.tier === 'combat')) return 'not within combat range'
  }
  if (scout && move !== 'run' && move !== 'reverse') return 'they scout while running'
  if (scout && getEnemyChasers(state, partyId).length === 0) return 'only those being chased scout'
  return null
}

// combat.tex "Running", "Inverting chase": the way each end of a link wants
// the distance to go — a chaser running closes in, a chased party running
// pulls away, and either running the other way wants the opposite; someone
// shooting or hiding stands, letting the other decide.
export function getWant(move: ChaseMove | undefined, role: ChaseRole): ChaseWay | null {
  if (move === 'run') return role === 'chaser' ? 'close' : 'open'
  if (move === 'reverse') return role === 'chaser' ? 'open' : 'close'
  return null
}

// Whether the link is a skirmish this round: enemies at shooting or far
// range, one of them shooting.
export function isSkirmishLink(state: SceneState, from: string): boolean {
  const link = getLink(state, from)
  const declarations = state.chase?.declarations ?? {}
  return !!link && isEnemyLink(state, from) && isSkirmishTier(link.tier) && (declarations[from]?.move === 'shoot' || declarations[link.chases]?.move === 'shoot')
}

// Both ends of an enemy link running at each other at combat range: they
// meet, and the fight starts (the table's ruling).
export function isMeeting(state: SceneState, from: string): boolean {
  const link = getLink(state, from)
  const declarations = state.chase?.declarations ?? {}
  return !!link && isEnemyLink(state, from) && link.tier === 'combat' && getWant(declarations[from]?.move, 'chaser') === 'close' && getWant(declarations[link.chases]?.move, 'chased') === 'close'
}

// Whether the link is settled by the chased party's hiding instead of a run.
export function isHidingLink(state: SceneState, from: string): boolean {
  const link = getLink(state, from)
  return !!link && isEnemyLink(state, from) && state.chase?.declarations[link.chases]?.move === 'hide'
}

// Why the round's chase cannot be resolved: it has been, a fight is played
// out first, someone is caught, the round is under way, or someone has not
// declared.
export function getResolveBar(state: SceneState): string | null {
  const chase = state.chase
  if (!chase) return 'there is no chase'
  if (state.round === 0) return 'press start combat to begin the first round'
  if (chase.resolved) return 'the round has been resolved'
  const first = getFightFirst(state)
  if (first) return first
  const busy = getFightBusy(state)
  if (busy) return busy
  if (state.turnsTaken.length > 0) return 'the round is under way'
  const caught = getChaseParties(state).flatMap((p) => getCaught(state, p))
  if (caught.length) return `caught: ${caught.map((c) => c.reason).join(', ')}`
  if (getActiveLinks(state).length === 0) return 'nobody is running this round'
  const waiting = getDeclarers(state).filter((p) => !chase.declarations[p])
  return waiting.length ? `still to declare: ${waiting.map((p) => partyName(state, p)).join(', ')}` : null
}

// combat.tex "Outrunning": "If the distance is already far and the winner
// decides to increase the distance, the chase is over" — and from the
// horizon a chase can only start at.
export function isOutrun(tier: ChaseTier, way: ChaseWay): boolean {
  return way === 'open' && (tier === 'far' || tier === 'horizon')
}

// One tier nearer or farther, never nearer than combat range.
export function stepTier(tier: ChaseTier, way: ChaseWay): ChaseTier {
  return CHASE_TIERS[Math.max(0, Math.min(CHASE_TIERS.length - 1, CHASE_TIERS.indexOf(tier) + (way === 'open' ? 1 : -1)))]
}

// The links that set the pace of the round: those between enemies, where
// there are any, else every one.
export function getPacingLinks(state: SceneState, links: string[]): string[] {
  const enemy = links.filter((p) => isEnemyLink(state, p))
  return enemy.length ? enemy : links
}

// How long the round took: a fight's round while one is being played out;
// else the shortest of the links run — a skirmish's, or a run's by the tier
// it was run at (combat.tex "Chain order of running": "Every chase round
// lasts the amount of time relative to the closest group's action"), as
// written when the round was resolved, or as it stands before.
export function getRoundSeconds(state: SceneState): number {
  const chase = state.chase
  if (!chase || getFightFirst(state)) return ROUND_SECONDS
  if (chase.resolved) return chase.seconds ?? ROUND_SECONDS
  const seconds = getPacingLinks(state, getActiveLinks(state)).map((p) => CHASE_ROUND_SECONDS[getLink(state, p)!.tier])
  return seconds.length ? Math.min(...seconds) : ROUND_SECONDS
}

// The round's length once its pacing links have been run.
export function getRunSeconds(runs: { tier: ChaseTier; skirmish: boolean }[]): number | null {
  return runs.length ? Math.min(...runs.map((r) => r.skirmish ? SKIRMISH_SECONDS : CHASE_ROUND_SECONDS[r.tier])) : null
}

// combat.tex "Routing": "When the pursuers are in combat range, but the
// quarry is not caught yet" — this round's run at combat range between
// enemies, won by the chaser closing in (the table's ruling), its chased
// party not caught.
export function isRoutingLink(state: SceneState, from: string): boolean {
  const run = getLink(state, from)?.run
  return !!state.chase?.resolved && run?.tier === 'combat' && run.winner === 'chaser' && run.way === 'close' && isEnemyLink(state, from) && isLinkLive(state, from)
}

// combat.tex "Routing": "the pursuers have +2 bonus to all uses of strike,
// accuracy and cunning".
export function getRoutingTerms(state: SceneState, id: string): Term[] {
  return isRoutingLink(state, state.partyOf[id] ?? '') ? [{ label: 'routing', value: 2 }] : []
}

// combat.tex "Rest": nobody running in a chase rests (the table's ruling) —
// only a party caught and fighting, or out of the chase.
export function getChaseRestBar(state: SceneState, id: string): string | null {
  const chase = state.chase
  const partyId = state.partyOf[id]
  if (!chase || partyId === undefined || chase.out.includes(partyId) || chase.fighting.includes(partyId)) return null
  return 'running in a chase'
}

// combat.tex "Chain order of running": a chase round is declared and run
// before anyone acts in it, and then only those it set routing or skirmishing
// act ("Routing", "Skirmish") — a party only running has nothing to do. A
// party caught and fighting, or out of the chase, takes turns as in a fight.
export function getChaseTurnBar(state: SceneState, id: string): string | null {
  const chase = state.chase
  const partyId = state.partyOf[id]
  if (!chase || partyId === undefined || chase.out.includes(partyId) || chase.fighting.includes(partyId)) return null
  if (!chase.resolved) return 'the chase round is resolved first'
  return isActingInChase(state, partyId) ? null : 'running this round'
}

// Whether the character's party has nothing to do in the resolved chase
// round, so it agrees to end the round without saying so.
export function isIdleInChase(state: SceneState, id: string): boolean {
  return !!state.chase?.resolved && getChaseTurnBar(state, id) !== null
}

// The party is at one end of a link the round set routing or skirmishing.
function isActingInChase(state: SceneState, partyId: string): boolean {
  return [partyId, ...getChasers(state, partyId)].some((from) => isRoutingLink(state, from) || !!getLink(state, from)?.run?.skirmish)
}

// In a chase, with no board under them, a party's members stand together:
// a guard by one stands in front of the others.
export function isChaseMate(state: SceneState, a: string, b: string): boolean {
  const party = state.partyOf[a]
  return !!state.chase && party !== undefined && party === state.partyOf[b] && !state.board?.placements[a]
}

// combat.tex "Cover": "If a character has cover, they can decide not to
// leave it and stay untargetable, but then they cannot target any enemy" —
// whether either of two on different teams stays in cover from the other.
export function isSheltered(state: SceneState, a: string, b: string): boolean {
  const chase = state.chase
  if (!chase) return false
  const apart = getTeam(chase, state.partyOf[a] ?? '') !== getTeam(chase, state.partyOf[b] ?? '')
  return apart && (chase.cover[a] === 'total' || chase.cover[b] === 'total')
}

// combat.tex "Cover": partial cover's bonus to the character's reflexes.
export function getChaseCoverTerms(state: SceneState, id: string): Term[] {
  return state.chase?.cover[id] === 'partial' ? [{ label: 'cover', value: CHASE_PARTIAL_COVER_REFLEX }] : []
}

// combat.tex "Skirmish": the AP a party has for the round it skirmishes in —
// 18 shooting, 8 moving; null for a party in no skirmish.
export function getSkirmishAP(state: SceneState, partyId: string): number | null {
  const chase = state.chase
  if (!chase?.resolved) return null
  const skirmishing = getChaseParties(state).some((p) => {
    const link = getLink(state, p)
    return link?.run?.skirmish && (p === partyId || link.chases === partyId)
  })
  if (!skirmishing) return null
  return chase.declarations[partyId]?.move === 'shoot' ? SKIRMISH_SHOOT_AP : SKIRMISH_APPROACH_AP
}

// The round's AP traded for a skirmish's, keeping what was owed into it
// (combat.tex "End of the round": "reset to 8 AP minus any negative AP").
export function getSkirmishAPOf(c: CampaignCharacter, AP: number): number {
  return AP + c.resources.AP - ROUND_AP
}

// combat.tex "Hiding at shooting distances": "The stealth test is done by the
// lowest stealth in the group [...] against the best of the opponent's
// detection" — the parties of a team hiding together this round, the one
// holding the worst stealth, and the enemies chasing any of them.
export function getHidingTest(state: SceneState, parties: string[], modifier: number): { skill: number; DL: number; worst: string } | null {
  const hiders = parties.flatMap((p) => getMembers(state, p))
  const seekers = [...new Set(parties.flatMap((p) => getEnemyChasers(state, p)))].flatMap((p) => getMembers(state, p))
  if (hiders.length === 0 || seekers.length === 0) return null
  const worst = hiders.reduce((a, b) => (getStealth(b) < getStealth(a) ? b : a))
  return { skill: getStealth(worst) + modifier, DL: Math.max(...seekers.map(getDetection)), worst: state.partyOf[worst.id] }
}

// combat.tex "Scouting": the fugitives look "using their detection skill" —
// the party's best.
export function getScoutSkill(state: SceneState, partyId: string): number | null {
  const members = getMembers(state, partyId)
  return members.length ? Math.max(...members.map(getDetection)) : null
}

const CROSSING: Record<CrossingSkill, (c: CampaignCharacter) => number> = { balance: getBalance, climb: getClimb, swim: getSwim }

// combat.tex "Hiding and Terrain": "Traversing an obstacle works just like
// running, but with a balance, climb or swim test [...] use the lowest skill
// in the group".
export function getCrossingSkill(state: SceneState, partyId: string, skill: CrossingSkill): number | null {
  const members = getMembers(state, partyId)
  return members.length ? Math.min(...members.map(CROSSING[skill])) : null
}

// combat.tex "Scouting": what the scouting test comes to — "A crit arrives
// at the place in the following round, a hit puts it in shooting distance,
// and a graze or miss fails".
export function getFoundTier(degree: string): ChaseTier | null {
  return degree === 'critical' ? 'combat' : degree === 'hit' ? 'shooting' : null
}

// The obstacle in front of the party: its own, reached, or the one reached
// by the enemy it chases.
export function getObstacleOwner(state: SceneState, partyId: string): string | null {
  const own = state.chase?.features[partyId]
  if (own?.reached && own.obstacle) return partyId
  const link = getLink(state, partyId)
  const ahead = link && isEnemyLink(state, partyId) ? state.chase?.features[link.chases] : null
  return ahead?.reached && ahead.obstacle ? link!.chases : null
}

// Why the party cannot try to cross: there is no obstacle reached in front
// of it, or it has tried this round.
export function getCrossBar(state: SceneState, partyId: string): string | null {
  if (!state.chase) return 'there is no chase'
  if (!getObstacleOwner(state, partyId)) return 'no obstacle reached'
  if (state.chase.rolls.some((r) => r.kind === 'cross' && r.parties.includes(partyId))) return 'they tried this round'
  return getFightBusy(state)
}

// The parties the party's link would make a loop with: itself and everyone
// chasing it, directly or down the chain.
function wouldLoop(state: SceneState, partyId: string, target: string): boolean {
  return getAncestry(state, target).has(partyId)
}

// Why the party cannot go after the target: it is out of the chase (put it
// back instead), the target is not in it or is fighting (join the fight
// instead), it would chase itself round the chain, or its round has been
// run.
export function getFollowBar(state: SceneState, partyId: string, target: string): string | null {
  const chase = state.chase
  if (!chase) return 'there is no chase'
  if (chase.out.includes(partyId)) return 'they are out of the chase'
  if (!state.parties[target] || chase.out.includes(target)) return 'that party is out of the chase'
  if (getLink(state, partyId)?.chases === target) return 'they chase them already'
  if (chase.fighting.includes(target)) return 'join the fight instead'
  if (wouldLoop(state, partyId, target)) return 'that would chase themselves round the chain'
  if (chase.resolved && getDeclarers(state).includes(partyId)) return 'the round has been run'
  return getFightBusy(state)
}

// combat.tex "Disconnected party": one out of the chase "cannot rejoin unless
// scouted from someone within the chase or hand placed back into the chain by
// the GM. When that happens, they can choose to chase someone".
export function getPutBackBar(state: SceneState, partyId: string, target: string): string | null {
  const chase = state.chase
  if (!chase) return 'there is no chase'
  if (!chase.out.includes(partyId)) return 'they are in the chase'
  if (partyId === target || !state.parties[target] || chase.out.includes(target)) return 'that party is out of the chase'
  return getFightBusy(state)
}

// The table's ruling: a party left behind may merge back into the party of
// its team it chases once it is within combat range of them.
export function getMergeBar(state: SceneState, partyId: string): string | null {
  const link = getLink(state, partyId)
  if (!link) return 'they chase nobody'
  if (isEnemyLink(state, partyId)) return 'they chase an enemy'
  if (link.tier !== 'combat') return 'only within combat range'
  if (state.chase!.fighting.includes(partyId) || state.chase!.fighting.includes(link.chases)) return 'not while fighting'
  return getFightBusy(state)
}

// Why the party cannot set off to join the fight: it is out of the chase, in
// that fight, on its way already, or too far ("any character from a group
// that is at shooting distance must spend one full round to arrive at the
// fight [...]. Anyone at far range or more is out").
export function getJoinBar(state: SceneState, partyId: string, to: string): string | null {
  const chase = state.chase
  if (!chase) return 'there is no chase'
  if (!chase.fighting.includes(to)) return 'there is no fight there'
  if (partyId === to || chase.fighting.includes(partyId)) return 'they are fighting'
  if (chase.out.includes(partyId)) return 'they are out of the chase'
  if (chase.joining[partyId]) return 'they are on their way'
  const tier = getPartyTierBetween(state, partyId, to)
  if (tier === 'far' || tier === 'horizon') return 'too far to reach the fight'
  if (getMembers(state, partyId).length === 0) return 'nobody left in the party'
  return getFightBusy(state)
}

// Why the table cannot have the party caught and fighting, or running again.
export function getFightBar(state: SceneState, partyId: string, fighting: boolean): string | null {
  const chase = state.chase
  if (!chase) return 'there is no chase'
  if (chase.out.includes(partyId)) return 'they are out of the chase'
  if (fighting && getEnemyChasers(state, partyId).length === 0 && !(getLink(state, partyId) && isEnemyLink(state, partyId))) return 'no enemy is after them'
  return getFightBusy(state)
}

// Who of the party may turn around: a party enemies chase.
export function canTurnAround(state: SceneState, id: string): boolean {
  return getEnemyChasers(state, state.partyOf[id] ?? '').length > 0
}

// combat.tex "Leave someone behind": the chase once a party splits in two —
// "The slower member of a split party starts chasing the faster ones. Any
// original pursuers begin chasing the slower group", the faster going on
// where the party was going; a party nobody chases splits into two going the
// same way. The new party keeps its team and whatever held the party.
export function getSplitChase(state: SceneState, from: string, to: string): Chase | null {
  const chase = state.chase
  if (!chase) return null
  const inherited: Chase = {
    ...chase,
    runaways: chase.runaways.includes(from) ? [...chase.runaways, to] : chase.runaways,
    fighting: chase.fighting.includes(from) ? [...chase.fighting, to] : chase.fighting,
    joining: chase.joining[from] ? { ...chase.joining, [to]: chase.joining[from] } : chase.joining,
    out: chase.out.includes(from) ? [...chase.out, to] : chase.out,
  }
  const link = chase.links[from]
  const chasers = Object.entries(chase.links).filter(([, l]) => l.chases === from).map(([p]) => p)
  if (chasers.length === 0) return link ? { ...inherited, links: { ...chase.links, [to]: { ...link, run: null } } } : inherited
  const tier = chase.links[chasers[0]].tier
  const [slow, fast] = getPartySpeed(state, from, tier) < getPartySpeed(state, to, tier) ? [from, to] : [to, from]
  const { [from]: _left, ...rest } = chase.links
  const links: Record<string, ChaseLink> = {
    ...rest,
    ...Object.fromEntries(chasers.map((p) => [p, { ...chase.links[p], chases: slow }])),
    ...(link ? { [fast]: link } : {}),
    [slow]: { chases: fast, tier: 'combat', run: null },
  }
  return { ...inherited, links }
}
