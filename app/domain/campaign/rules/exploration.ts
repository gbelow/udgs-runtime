import type { CampaignCharacter } from '../../types'
import type { ExplorationAction } from '../../lists'
import type { CampaignState, Group, GroupKind, Party, Table } from '../types'
import type { Degree } from '../../combat/types'
import type { Test } from '../../combat/rules/test'
import { getAwareness, getSTA } from '../../character/rules/characteristics'
import { getHealth, getWill } from '../../character/rules/skills'
import { getKnowledge } from '../../character/rules/knowledge'
import { hasAffliction, isDead } from '../../character/rules/afflictions'

// survival.tex "Exploration Action (EA)": the four camp tasks are Prepare.
export function getExplorationAction(kind: GroupKind): ExplorationAction {
  return kind === 'travel' || kind === 'search' ? kind : 'prepare'
}

// survival.tex "Exploring and traveling": travel and search take the group
// away from the rest of the party for the ET.
export function isAway(kind: GroupKind): boolean {
  return getExplorationAction(kind) !== 'prepare'
}

// survival.tex "Wear": "The basic wear is to increase IL by +1"; "STA < 8 =
// +1 IL per EA. STA < 6 = +2 IL and so on", read off the derived STA (the
// table's ruling); combat.tex "Lame": "Takes +2 IL for traveling and
// Searching".
export function getWear(c: CampaignCharacter, action: ExplorationAction): number {
  const stamina = Math.max(0, Math.floor((9 - getSTA(c)) / 2))
  const lame = action !== 'prepare' && hasAffliction(c, 'lame') ? 2 : 0
  return 1 + stamina + lame
}

// survival.tex "Rest": "heals IL equal to 1+(health-exposure)/2. Negative
// values work against the character."
export function getRestHealing(c: CampaignCharacter, exposure: number): number {
  return 1 + Math.floor((getHealth(c) - exposure) / 2)
}

// survival.tex "Rest": "lowers exhaustion by 3 - exposure/2 instead of
// increasing it".
export function getRestRecovery(exposure: number): number {
  return 3 - Math.floor(exposure / 2)
}

// survival.tex "Shelter": "improves the exposure for resting by 1 on a hit
// and by 2 on a crit"; "Campfire": "reduces exposure to cold and insects by
// 1", taken as any exposure until terrain carries its tags.
export function getRestExposure(party: Party): number {
  return Math.max(0, party.exposure - party.camp.shelter - (party.camp.fire ? 1 : 0))
}

// survival.tex "Rest": "Resting only heals 3 times per day. Any further
// resting does not heal nor lower exhaustion and just counts as being idle."
const RESTS_PER_DAY = 3

export function canRestHeal(state: CampaignState, id: string): boolean {
  return (state.rests[id] ?? 0) < RESTS_PER_DAY
}

// survival.tex "Exhaustion": "Any ET where the character starts with
// exhaustion at 12 or higher, it has to make a Will test with a DL equal to
// character's exhaustion - 10."
export function getExhaustionTest(c: CampaignCharacter): Test | null {
  const exhaustion = c.resources.exhaustion
  return exhaustion >= 12 ? { skill: getWill(c), DL: exhaustion - 10, explodes: false, scale: 'degrees' } : null
}

// survival.tex "Exhaustion": "If the character grazes or misses, it is forced
// to rest wherever it is."
export function isForcedToRest(degree: Degree | undefined): boolean {
  return degree === 'miss' || degree === 'graze'
}

export function isForced(state: CampaignState, id: string): boolean {
  return isForcedToRest(state.opening?.rolls[id]?.degree)
}

// survival.tex "Night and Darkness": "If the group has a light source or the
// ability to see in the dark, the DL for travel and search is increased by
// just +5. If the group is without vision, search and travel increases by
// +10."
const NIGHT_DL = { day: 0, lit: 5, dark: 10 } as const

// survival.tex "Exploration": travel and search test the Exploration skill,
// "the specific knowledge about the location + the awareness proficiency",
// the knowledge entered by the table; "Prepare": "The skill used is 2x
// survival knowledge".
export function getGroupTest(c: CampaignCharacter, group: Group, party: Party): Test {
  const away = isAway(group.kind)
  const skill = away ? group.knowledge + getAwareness(c) : 2 * getKnowledge('survival')(c)
  return { skill, DL: group.DL + (away ? NIGHT_DL[party.light] : 0), explodes: false, scale: 'degrees' }
}

// Everyone in the party, on the roster or sent to a fight.
export function getPartyMembers(state: CampaignState, partyId: string): string[] {
  return Object.keys(state.partyOf).filter((id) => state.partyOf[id] === partyId)
}

// Who in the party plays the coming ET: on the roster, alive, and not sent
// to a fight during it.
export function getPartyPlayers(state: CampaignState, partyId: string): string[] {
  return getPartyMembers(state, partyId).filter((id) => {
    const c = state.characters[id]
    return c && !isDead(c) && !state.out.includes(id)
  })
}

// The forced resters whose group goes away, and who must be left behind,
// stayed with or carried.
export function getDecisionsCalled(state: CampaignState): string[] {
  return Object.values(state.parties).flatMap((party) =>
    Object.values(party.groups).filter((g) => isAway(g.kind)).flatMap((g) => g.members.filter((id) => isForced(state, id))))
}

// Why the character cannot change their plan or eat and drink now. The ET
// loop runs on the roster; whoever is in a fight is not on it.
export function getExplorationBar(state: CampaignState, id: string): string | null {
  const c = state.characters[id]
  if (!c) return 'not with the party'
  if (isDead(c)) return 'dead'
  return null
}

// Why the group cannot be gone on: "only one character rolls for it", and
// that one must be with the group and able to.
function getRollerBar(state: CampaignState, partyId: string, group: Group): string | null {
  const party = state.parties[partyId]
  const players = getPartyPlayers(state, partyId).filter((id) => group.members.includes(id))
  if (players.length === 0) return null
  if (!group.roller || !players.includes(group.roller)) return `${party.name} ${group.kind} needs a roller`
  return isForced(state, group.roller) ? `${party.name} ${group.kind} needs another roller` : null
}

// Why the ET cannot pass now: it passes for everyone, a fight is counted in
// rounds until it is over, every group needs its roller, and every forced
// rest whose group goes away needs a decision.
export function getPassBar(table: Table): string | null {
  if (Object.keys(table.fight.characters).length > 0) return 'a fight is going on'
  const state = table.campaign
  for (const [partyId, party] of Object.entries(state.parties)) {
    for (const group of Object.values(party.groups)) {
      const bar = getRollerBar(state, partyId, group)
      if (bar) return bar
    }
  }
  const undecided = getDecisionsCalled(state).find((id) => !state.opening?.decisions[id])
  return undecided ? `decide for ${state.characters[undecided]?.fightName ?? undecided}` : null
}
