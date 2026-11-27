import type { ScenePreset } from '../../campaign/types'
import { DEMO_FIGHT_MOST, DEMO_PARTY_MOST, type DemoSide } from '../../demo'

// The demo's parties as the visitor makes them up, one for each of the
// scene's (each with its own spawn area), at most `DEMO_PARTY_MOST` in one
// and `DEMO_FIGHT_MOST` in all (the user's ruling, 2026-11-27).

// The scene's line-up for each of its parties, by key, one for each copy.
export function getLineups(preset: ScenePreset): string[][] {
  return preset.parties.map((p) => p.members.flatMap((m) => Array.from({ length: Math.max(0, m.count) }, () => m.key)))
}

// The parties as the visitor made them up (`stored`), or, before they have
// made any up for this scene, as it comes: the party it marks for the
// visitor theirs to fill and play, every other filled with its line-up.
export function getDemoSides(preset: ScenePreset, stored: readonly DemoSide[]): DemoSide[] {
  if (stored.length === preset.parties.length) return [...stored]
  const lineups = getLineups(preset)
  return preset.parties.map((p, i) => ({ picks: p.visitor ? [] : lineups[i].slice(0, DEMO_PARTY_MOST), you: p.visitor }))
}

// Why party `at` takes nobody more, or null.
export function getSideFullBar(sides: readonly DemoSide[], at: number): string | null {
  const total = sides.reduce((n, s) => n + s.picks.length, 0)
  return (sides[at]?.picks.length ?? 0) >= DEMO_PARTY_MOST ? `a party takes at most ${DEMO_PARTY_MOST}`
    : total >= DEMO_FIGHT_MOST ? `the fight takes at most ${DEMO_FIGHT_MOST}`
    : null
}
