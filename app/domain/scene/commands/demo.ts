import { CampaignStateSchema, type ScenePreset } from '../../campaign/types'
import { getPresetCast, getScenePartyId } from '../../campaign/rules/scenes'
import type { CharacterOwners } from '../../profiles'
import { DEMO_BOT, DEMO_PARTY_MOST, DEMO_SCENE, DEMO_VISITOR, type DemoSide } from '../../demo'
import { SceneStateSchema, type Table } from '../types'
import { getLineups, getSideFullBar } from '../rules/demo'
import { loadBoardMap, placeParty } from './board'
import { bringInCast } from './episode'

// The demo's fight, who plays whom in it, and which fight party is the
// visitor's (none while they watch).
export type DemoTable = { table: Table; owners: CharacterOwners; party: string | null }

// The demo's fight, made fresh: the prepared scene played with each of its
// parties made of the catalog characters the visitor picked for it (`sides`,
// one for each of the scene's parties, in its order, by key, one each), the
// one marked theirs played by them and every other by the bot, already
// standing in its spawn area. A party nobody was picked for stays out. Null
// for a scene with no parties.
export function playDemo(preset: ScenePreset, sides: readonly DemoSide[], board: unknown | null, sheets: Record<string, unknown>, newId: () => string): DemoTable | null {
  if (preset.parties.length === 0) return null
  const yours = sides.findIndex((s) => s.you)
  const played: ScenePreset = {
    ...preset,
    parties: preset.parties.map((p, i) => {
      const side = sides[i]
      const player = i === yours ? DEMO_VISITOR : DEMO_BOT
      return { ...p, members: (side?.picks ?? []).map((key) => ({ key, count: 1, player })) }
    }),
  }
  const cast = getPresetCast(DEMO_SCENE, played, (p, m) => played.parties[p].members[m].player).filter((c) => sheets[c.key])
  const fight = SceneStateSchema.parse({})
  const empty: Table = { campaign: CampaignStateSchema.parse({}), fight: board === null ? fight : loadBoardMap(board)(fight) }
  const table = bringInCast(DEMO_SCENE, played, cast, sheets, newId)(empty)
  const party = yours < 0 ? null : getScenePartyId(DEMO_SCENE, yours)
  const bots = [...new Set(cast.map((c) => c.party))].filter((p) => p !== party)
  const deployed = bots.reduce((s, p) => placeParty(p)(s), table.fight)
  const owners = Object.fromEntries(cast.flatMap((c) => (c.player === null ? [] : [[c.id, c.player]])))
  return { table: { ...table, fight: deployed }, owners, party }
}

// The presses that make the parties up before the demo is joined, over the
// parties as the visitor has them (`getDemoSides`).

// Every party filled with the scene's line-up for it, each played by whoever
// plays it now.
export function fillDemoSides(preset: ScenePreset, sides: readonly DemoSide[]): DemoSide[] {
  const lineups = getLineups(preset)
  return sides.map((s, i) => ({ ...s, picks: (lineups[i] ?? []).slice(0, DEMO_PARTY_MOST) }))
}

// The visitor playing party `at` (`you`), or the bot playing it: they play at
// most one.
export function playDemoSide(sides: readonly DemoSide[], at: number, you: boolean): DemoSide[] {
  return sides.map((s, i) => ({ ...s, you: i === at ? you : you ? false : s.you }))
}

// `key` picked for party `at`, unless it takes nobody more.
export function addDemoPick(sides: readonly DemoSide[], at: number, key: string): DemoSide[] {
  if (getSideFullBar(sides, at) !== null) return [...sides]
  return sides.map((s, i) => (i === at ? { ...s, picks: [...s.picks, key] } : s))
}

// The `n`-th pick of party `at` taken out.
export function removeDemoPick(sides: readonly DemoSide[], at: number, n: number): DemoSide[] {
  return sides.map((s, i) => (i === at ? { ...s, picks: s.picks.filter((_, j) => j !== n) } : s))
}
