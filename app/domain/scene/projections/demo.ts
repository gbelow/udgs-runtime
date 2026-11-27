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
import type { DemoHint, DemoSide } from '../../demo'
import { getDemoSides, getLineups, getSideFullBar } from '../rules/demo'
import { getSpawnParties } from '../rules/board/spawn'
import { getFightName } from '../rules/fighters'

// The demo as the visitor sees it: making up the parties before the fight,
// placing theirs, the fight's start, and how it ended.

// The party picker: the catalog characters offered, and each of the scene's
// parties as the visitor is making it up: its name, the tint of its spawn
// area, the line-up the scene gives it (offered ready-made), the picks, who
// plays it, and why it takes nobody more; and why the fight cannot be joined
// yet.
export type DemoPicker = {
  scene: string
  offered: { key: string; name: string; tags: string[]; description: string }[]
  sides: {
    name: string
    // the tint of its spawn area (`SPAWN_SWATCH`), null for placed anywhere
    area: number | null
    lineup: string[]
    picks: { key: string; name: string }[]
    you: boolean
    fullBar: string | null
  }[]
  // whether the visitor plays none of the parties, and only watches
  watching: boolean
  joinBar: string | null
}

// `offered`: the keys the demo's collection names, or null for the whole
// character catalog; only those the catalog has are offered, and a pick of
// one neither offered nor in a line-up of the scene's is dropped.
export function getDemoPicker(preset: ScenePreset, characters: readonly BaseCharacter[], offered: readonly string[] | null, stored: readonly DemoSide[]): DemoPicker {
  const byKey = new Map(characters.map((c) => [c.name, c]))
  const lineups = getLineups(preset).map((l) => l.filter((key) => byKey.has(key)))
  const allowed = (key: string) => byKey.has(key) && (!offered || offered.includes(key) || lineups.some((l) => l.includes(key)))
  const rows = (offered ?? characters.map((c) => c.name)).flatMap((key) => {
    const c = byKey.get(key)
    return c ? [{ key, name: c.name, tags: c.tags, description: c.description.trim() }] : []
  })
  const sides = getDemoSides(preset, stored).map((s) => ({ ...s, picks: s.picks.filter(allowed) }))
  // the fight tints the areas of the parties it brings in, in the scene's order
  const tinted = sides.flatMap((s, i) => (s.picks.length > 0 && preset.parties[i].spawn.length > 0 ? [i] : []))
  return {
    scene: preset.name,
    offered: rows,
    sides: sides.map((s, i) => ({
      name: preset.parties[i].name || `party ${i + 1}`,
      area: tinted.indexOf(i) + 1 || null,
      lineup: lineups[i],
      picks: s.picks.map((key) => ({ key, name: byKey.get(key)?.name ?? key })),
      you: s.you,
      fullBar: getSideFullBar(sides, i),
    })),
    watching: !sides.some((s) => s.you && s.picks.length > 0),
    joinBar: preset.parties.length === 0 ? 'the demo scene has no parties'
      : sides.filter((s) => s.picks.length > 0).length < 2 ? 'fill at least two parties'
      : null,
  }
}

export type DemoFate = 'standing' | 'surrendered' | 'down' | 'dead'
// `over`: decided, watched with no party of the visitor's in it
export type DemoOutcome = 'won' | 'lost' | 'draw' | 'over'

export type DemoView = {
  // the tint of the spawn area the visitor's party is placed in
  // (`getSpawnParties`), null for anywhere
  area: number | null
  members: { id: string; name: string; placed: boolean }[]
  // why the first round cannot start yet
  startBar: string | null
  // what they are told now, once the fight has begun
  hint: DemoHint | null
  // once the fight is decided: who won (the party left standing, none for a
  // draw), and how everyone of each party came out of it
  result: {
    outcome: DemoOutcome
    winner: string | null
    parties: { id: string; name: string; yours: boolean; rows: { id: string; name: string; fate: DemoFate }[] }[]
  } | null
}

// `party`: the visitor's fight party, null while they watch; `started`:
// whether they said the fight may begin; `seen`: the hints they have put
// away.
export function getDemoView(state: SceneState, party: string | null, started: boolean, seen: readonly DemoHint[]): DemoView {
  const ids = Object.keys(state.characters)
  const mine = party === null ? [] : ids.filter((id) => state.partyOf[id] === party)
  const unplaced = ids.filter((id) => !state.board?.placements[id])
  const theirs = unplaced.filter((id) => !mine.includes(id))
  const standing = getStandingParties(state)
  const decided = started && standing.length <= 1
  const fate = (id: string): DemoFate => {
    const c = state.characters[id]
    return !c || isDead(c) ? 'dead' : isDown(state, id) ? 'down' : state.surrendered.includes(id) ? 'surrendered' : 'standing'
  }
  const name = (partyId: string) => state.parties[partyId]?.name || partyId
  const parties = [...new Set(ids.map((id) => state.partyOf[id] ?? ''))]
  return {
    area: party === null ? null : getSpawnParties(state).indexOf(party) + 1 || null,
    members: mine.map((id) => ({ id, name: getFightName(state, id), placed: !unplaced.includes(id) })),
    startBar: started ? 'the fight has begun'
      : theirs.length > 0 ? `there is no room in their party's area for ${theirs.map((id) => getFightName(state, id)).join(', ')}`
      : unplaced.length > 0 ? `place ${unplaced.map((id) => getFightName(state, id)).join(', ')} first`
      : getNextRoundBar(state),
    hint: started && !decided ? getDemoHint(state, mine, seen) : null,
    result: decided ? {
      outcome: standing.length === 0 ? 'draw' : party === null ? 'over' : standing[0] === party ? 'won' : 'lost',
      winner: standing.length === 0 ? null : name(standing[0]),
      parties: parties.map((p) => ({
        id: p,
        name: name(p),
        yours: p === party,
        rows: ids.filter((id) => (state.partyOf[id] ?? '') === p).map((id) => ({ id, name: getFightName(state, id), fate: fate(id) })),
      })),
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
