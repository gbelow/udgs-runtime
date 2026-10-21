import { z } from 'zod'
import sceneCatalog from '../../../assets/scenes.json'
import { ScenePresetSchema, type CampaignState, type ScenePreset } from '../types'

// The scenes prepared in the catalog for events to lead to.
const PRESETS: Record<string, ScenePreset> = z.record(z.string(), ScenePresetSchema).parse(sceneCatalog)

export function getScenePresets(): { key: string; name: string }[] {
  return Object.entries(PRESETS).map(([key, p]) => ({ key, name: p.name || key }))
}

// The preset, or, gone from the catalog, one with nothing in it but its key.
export function getScenePreset(key: string): ScenePreset {
  return PRESETS[key] ?? ScenePresetSchema.parse({ name: key })
}

// A prepared scene waiting for one of these parties holds their time: it is
// played out, or passed by, before it passes.
export function getWaitingSceneBar(state: CampaignState, partyIds: readonly string[]): string | null {
  const waiting = Object.values(state.scenes).find((s) => partyIds.includes(s.party))
  return waiting ? `${getScenePreset(waiting.preset).name} waits to be played${waiting.forced ? '' : ' or passed by'}` : null
}

// Why the waiting scene may not be played now: another fight is going on,
// which every character in it is lent to.
export function getPlaySceneBar(state: CampaignState, sceneId: string): string | null {
  if (!state.scenes[sceneId]) return 'no such scene'
  return state.lent.length > 0 ? 'a fight is under way' : null
}

// Why the scene may not be passed by: one forced must be played.
export function getPassByBar(state: CampaignState, sceneId: string): string | null {
  const waiting = state.scenes[sceneId]
  if (!waiting) return 'no such scene'
  return waiting.forced ? 'a forced scene must be played' : null
}
