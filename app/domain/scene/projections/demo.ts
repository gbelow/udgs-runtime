import type { BaseCharacter } from '../../types'
import type { ScenePreset } from '../../campaign/types'
import type { SceneState } from '../types'
import { isDead } from '../../character/rules/afflictions'
import { getStandingParties, isDown } from '../rules/fight'
import { getFightBusy, getNextRoundBar, getStartTurnBar, hasAgreedToEnd } from '../rules/turn'
import { getRoundChangeBar } from '../rules/roundChange'
import { isCombatStarted } from '../rules/started'
import { getOpenAction } from '../rules/log'
import { getAnswersOwed } from '../rules/options'
import type { DemoHint } from '../../demo'
import { getSpawnParties } from '../rules/board/spawn'
import { getFightName } from '../rules/fighters'

// The demo as the visitor sees it: picking their party before the fight,
// placing it, the fight's start, and how it ended.

// The party picker: the catalog characters offered, the line-up the scene's
// party for the visitor is made of (offered ready-made), how many the party
// takes, and why it cannot join yet.
export type DemoPicker = {
  scene: string
  offered: { key: string; name: string; tags: string[]; description: string }[]
  lineup: string[]
  slots: number
  picks: { key: string; name: string }[]
  full: boolean
  joinBar: string | null
}

// `offered`: the keys the demo's collection names, or null for the whole
// character catalog; only those the catalog has are offered.
export function getDemoPicker(preset: ScenePreset, characters: readonly BaseCharacter[], offered: readonly string[] | null, picks: readonly string[]): DemoPicker {
  const party = preset.parties.find((p) => p.visitor)
  const lineup = party ? party.members.flatMap((m) => Array.from({ length: Math.max(0, m.count) }, () => m.key)) : []
  const slots = Math.max(1, lineup.length)
  const byKey = new Map(characters.map((c) => [c.name, c]))
  const rows = (offered ?? characters.map((c) => c.name)).flatMap((key) => {
    const c = byKey.get(key)
    return c ? [{ key, name: c.name, tags: c.tags, description: c.description.trim() }] : []
  })
  const kept = picks.filter((key) => byKey.has(key) && (!offered || offered.includes(key) || lineup.includes(key)))
  return {
    scene: preset.name,
    offered: rows,
    lineup: lineup.filter((key) => byKey.has(key)),
    slots,
    picks: kept.map((key) => ({ key, name: byKey.get(key)?.name ?? key })),
    full: kept.length >= slots,
    joinBar: !party ? 'the demo scene has no party for the visitor' : kept.length === 0 ? 'pick at least one character' : null,
  }
}

export type DemoFate = 'standing' | 'surrendered' | 'down' | 'dead'
export type DemoOutcome = 'won' | 'lost' | 'draw'

export type DemoView = {
  // the tint of the spawn area the visitor's party is placed in
  // (`getSpawnParties`), null for anywhere
  area: number | null
  members: { id: string; name: string; placed: boolean }[]
  // why the first round cannot start yet
  startBar: string | null
  // what they are told now, once the fight has begun
  hint: DemoHint | null
  // once the fight is decided: who won, and how everyone came out of it
  result: { outcome: DemoOutcome; rows: { id: string; name: string; yours: boolean; fate: DemoFate }[] } | null
}

// `party`: the visitor's fight party; `started`: whether they said the
// fight may begin; `seen`: the hints they have put away.
export function getDemoView(state: SceneState, party: string, started: boolean, seen: readonly DemoHint[]): DemoView {
  const ids = Object.keys(state.characters)
  const mine = ids.filter((id) => state.partyOf[id] === party)
  const unplaced = mine.filter((id) => !state.board?.placements[id])
  const standing = getStandingParties(state)
  const decided = started && standing.length <= 1
  const fate = (id: string): DemoFate => {
    const c = state.characters[id]
    return !c || isDead(c) ? 'dead' : isDown(state, id) ? 'down' : state.surrendered.includes(id) ? 'surrendered' : 'standing'
  }
  return {
    area: getSpawnParties(state).indexOf(party) + 1 || null,
    members: mine.map((id) => ({ id, name: getFightName(state, id), placed: !unplaced.includes(id) })),
    startBar: started ? 'the fight has begun'
      : unplaced.length > 0 ? `place ${unplaced.map((id) => getFightName(state, id)).join(', ')} first`
      : getNextRoundBar(state),
    hint: started && !decided ? getDemoHint(state, mine, seen) : null,
    result: decided ? {
      outcome: standing.length === 0 ? 'draw' : standing[0] === party ? 'won' : 'lost',
      rows: ids.map((id) => ({ id, name: getFightName(state, id), yours: mine.includes(id), fate: fate(id) })),
    } : null,
  }
}

// The hint for where the fight stands for the visitor's characters (`mine`),
// unless they have put it away.
function getDemoHint(state: SceneState, mine: readonly string[], seen: readonly DemoHint[]): DemoHint | null {
  const open = getOpenAction(state)
  const hint: DemoHint | null = getAnswersOwed(state).some((id) => mine.includes(id)) ? 'answer'
    : open?.step === 'define' && mine.includes(open.actorId) ? 'action'
    : isRoundOnly(state, mine) ? 'round'
    : mine.some((id) => getStartTurnBar(state, id) === null) ? 'turn'
    : null
  return hint !== null && !seen.includes(hint) ? hint : null
}

// Whether the round's end waits on nobody but some of `ids`.
function isRoundOnly(state: SceneState, ids: readonly string[]): boolean {
  if (!isCombatStarted(state) || getFightBusy(state) !== null || getRoundChangeBar(state) !== null) return false
  const waiting = Object.keys(state.characters).filter((id) => !hasAgreedToEnd(state, id))
  return waiting.length > 0 && waiting.every((id) => ids.includes(id))
}
