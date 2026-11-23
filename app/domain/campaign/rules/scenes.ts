import { z } from 'zod'
import sceneCatalog from '../../../assets/scenes.json'
import { ScenePresetSchema, type CampaignState, type ScenePreset, type WaitingScene } from '../types'
import type { Actor, CharacterOwners } from '../../profiles'

// The scenes prepared in the catalog for events to lead to.
const PRESETS: Record<string, ScenePreset> = z.record(z.string(), ScenePresetSchema).parse(sceneCatalog)

export function getScenePresets(): { key: string; name: string }[] {
  return Object.entries(PRESETS).map(([key, p]) => ({ key, name: p.name || key }))
}

// The preset, or, gone from the catalog, one with nothing in it but its key.
export function getScenePreset(key: string): ScenePreset {
  return PRESETS[key] ?? ScenePresetSchema.parse({ name: key })
}

// A line of a preset's parties, as a waiting scene names it.
export function getSceneSlot(party: number, member: number): string {
  return `${party}/${member}`
}

// Who plays a line of the preset's parties in this waiting scene: the
// table's word for it, or else the preset's.
export function getScenePlayer(waiting: WaitingScene, preset: ScenePreset, party: number, member: number): string | null {
  const slot = getSceneSlot(party, member)
  return slot in waiting.players ? waiting.players[slot] : preset.parties[party]?.members[member]?.player ?? null
}

// One character a waiting scene brings into its fight when it is played.
export type SceneCast = { id: string; key: string; party: string; partyName: string; player: string | null }

// Everyone the waiting scene brings in, each a new copy of a catalog
// character: under an id and in a fight party made from the scene's own id,
// so who plays them is known before it is played.
export function getSceneCast(sceneId: string, waiting: WaitingScene): SceneCast[] {
  const preset = getScenePreset(waiting.preset)
  return getPresetCast(sceneId, preset, (p, m) => getScenePlayer(waiting, preset, p, m))
}

// Everyone a preset brings in when played as `sceneId`, each played by
// whoever `playerOf` says plays their line.
export function getPresetCast(sceneId: string, preset: ScenePreset, playerOf: (party: number, member: number) => string | null): SceneCast[] {
  return preset.parties.flatMap((party, p) => party.members.flatMap((member, m) =>
    Array.from({ length: Math.max(0, member.count) }, (_, n) => ({
      id: `${sceneId}:${p}:${m}:${n}`, key: member.key, party: getScenePartyId(sceneId, p), partyName: party.name,
      player: playerOf(p, m),
    }))))
}

// The fight party a preset's party is brought in as, played as `sceneId`.
export function getScenePartyId(sceneId: string, party: number): string {
  return `${sceneId}:${party}`
}

// The spawn area each of the preset's parties is placed in, by the fight
// party it is brought in as; a party placed anywhere has none.
export function getSceneSpawns(sceneId: string, preset: ScenePreset): Record<string, string[]> {
  return Object.fromEntries(preset.parties.flatMap((party, p) => (party.spawn.length > 0 ? [[getScenePartyId(sceneId, p), party.spawn]] : [])))
}

// The catalog characters the waiting scene is played with, by key.
export function getSceneKeys(waiting: WaitingScene): string[] {
  return [...new Set(getScenePreset(waiting.preset).parties.flatMap((p) => p.members.map((m) => m.key)))]
}

// Who plays each of those the waiting scene brings in, but the GM's.
export function getScenePlayers(state: CampaignState, sceneId: string): CharacterOwners {
  const waiting = state.scenes[sceneId]
  if (!waiting) return {}
  return Object.fromEntries(getSceneCast(sceneId, waiting).flatMap((c) => (c.player === null ? [] : [[c.id, c.player]])))
}

// A prepared scene waiting for one of these parties holds their time: it is
// played out, or passed by, before it passes.
export function getWaitingSceneBar(state: CampaignState, partyIds: readonly string[]): string | null {
  const waiting = Object.values(state.scenes).find((s) => partyIds.includes(s.party))
  return waiting ? `${getScenePreset(waiting.preset).name} waits to be played${waiting.forced ? '' : ' or passed by'}` : null
}

// Why the waiting scene may not be played now: another fight is going on,
// which every character in it is lent to, and everyone must be taken out of
// it first. The dead lying where a fight left them keep their ids lent, and
// hold no fight.
export function getPlaySceneBar(state: CampaignState, sceneId: string): string | null {
  if (!state.scenes[sceneId]) return 'no such scene'
  const lying = new Set(Object.values(state.fallen).flat().map((c) => c.id))
  return state.lent.some((id) => !lying.has(id)) ? 'a scene is under way: take everyone out of it first' : null
}

// Why the scene may not be passed by: one forced must be played.
export function getPassByBar(state: CampaignState, sceneId: string): string | null {
  const waiting = state.scenes[sceneId]
  if (!waiting) return 'no such scene'
  return waiting.forced ? 'a forced scene must be played' : null
}

// Who may play or pass by a waiting scene: anyone who met it, or the GM for
// one nobody was sent to.
export function getSceneActor(members: readonly string[]): Actor {
  return members.length > 0 ? { anyOf: members } : 'gm'
}

// Why the scene cannot be loaded from the catalog: there is no such preset.
export function getLoadSceneBar(preset: string): string | null {
  return getScenePresets().some((p) => p.key === preset) ? null : 'no such scene in the catalog'
}
