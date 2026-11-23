import { ScenePartySchema, type ScenePartyMember, type ScenePreset } from '../types'

// The edits of a prepared scene in the catalog: its parties, and the catalog
// characters each is made of.

type PresetUpdater = (preset: ScenePreset) => ScenePreset

const withParties = (preset: ScenePreset, parties: ScenePreset['parties']): ScenePreset => ({ ...preset, parties })

// A new party, empty.
export function addSceneParty(name: string): PresetUpdater {
  return (preset) => withParties(preset, [...preset.parties, ScenePartySchema.parse({ name })])
}

export function renameSceneParty(party: number, name: string): PresetUpdater {
  return (preset) => withParties(preset, preset.parties.map((p, i) => (i === party ? { ...p, name } : p)))
}

// The spawn area a party is placed in (0 for anywhere).
export function setScenePartySpawn(party: number, spawn: number): PresetUpdater {
  return (preset) => withParties(preset, preset.parties.map((p, i) => (i === party ? { ...p, spawn: Math.max(0, Math.floor(spawn)) } : p)))
}

// Whether a party is the one the demo's visitor plays: one party at most.
export function setScenePartyVisitor(party: number, visitor: boolean): PresetUpdater {
  return (preset) => withParties(preset, preset.parties.map((p, i) => ({ ...p, visitor: i === party ? visitor : visitor ? false : p.visitor })))
}

export function removeSceneParty(party: number): PresetUpdater {
  return (preset) => withParties(preset, preset.parties.filter((_, i) => i !== party))
}

// A catalog character joins the party: one more copy of a line it already
// has, or a line of its own, played by the GM.
export function addSceneMember(party: number, key: string): PresetUpdater {
  return (preset) => withParties(preset, preset.parties.map((p, i) => {
    if (i !== party) return p
    const line = p.members.findIndex((m) => m.key === key)
    return line < 0
      ? { ...p, members: [...p.members, { key, count: 1, player: null }] }
      : { ...p, members: p.members.map((m, j) => (j === line ? { ...m, count: m.count + 1 } : m)) }
  }))
}

// A line's count (at least one) or who plays it.
export function setSceneMember(party: number, member: number, change: Partial<Pick<ScenePartyMember, 'count' | 'player'>>): PresetUpdater {
  return (preset) => withParties(preset, preset.parties.map((p, i) => (i !== party ? p : {
    ...p,
    members: p.members.map((m, j) => (j !== member ? m : { ...m, ...change, count: Math.max(1, change.count ?? m.count) })),
  })))
}

export function removeSceneMember(party: number, member: number): PresetUpdater {
  return (preset) => withParties(preset, preset.parties.map((p, i) => (i === party ? { ...p, members: p.members.filter((_, j) => j !== member) } : p)))
}
