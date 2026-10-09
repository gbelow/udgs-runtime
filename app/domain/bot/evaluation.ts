import type { CampaignCharacter } from '../types'
import type { SceneState } from '../scene/types'
import { setDistance } from '../scene/geometry'
import { canAfford } from '../character/rules/cost'
import { getSTA } from '../character/rules/characteristics'
import weapons from '../../assets/weapons.json'
import armors from '../../assets/armors.json'
import ammo from '../../assets/ammo.json'
import items from '../../assets/items.json'
import containers from '../../assets/containers.json'
import abilities from '../../assets/abilities.json'
import { estimateAttacks, guardedBy, rankAttacks, type AttackEstimate } from './estimate'

// What an attack comes to is a property of the two characters and the gap
// between them, not of how much AP and STA they happen to hold. The estimate is
// therefore made once, with both of them rested, and kept under what it was made
// of: everything either carries but its resources and the surge it has used,
// the distance between them, the grapples they are in and the catalogs the gear
// is read from. It is read back against the resources they have now: the
// attacks the attacker can pay for, each against the answers the target can
// still pay for.

export type Evaluations = Record<string, AttackEstimate[]>

const REST_AP = 99

// What the catalogs say, as a short hash: a character stores which item it holds,
// and the numbers an attack comes to are read from the catalog when it is asked.
function fingerprint(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(36)
}

const CATALOGS = fingerprint(JSON.stringify([weapons, armors, ammo, items, containers, abilities]))

function carried(c: CampaignCharacter): Omit<CampaignCharacter, 'resources' | 'usedSurge'> {
  const { resources: _resources, usedSurge: _usedSurge, ...rest } = c
  return rest
}

function gapBetween(state: SceneState, a: string, b: string): number | null {
  const ca = state.board?.placements[a]?.cell
  const cb = state.board?.placements[b]?.cell
  return ca && cb ? setDistance([ca], [cb]) : null
}

// The same value always gives the same text, whatever order its keys were made in.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v)
}

export function getEvaluationKey(state: SceneState, attackerId: string, targetId: string): string {
  const pair = [attackerId, targetId]
  return canonical([
    carried(state.characters[attackerId]),
    carried(state.characters[targetId]),
    gapBetween(state, attackerId, targetId),
    state.binds.filter((b) => b.members.some((m) => pair.includes(m))),
    CATALOGS,
  ])
}

function rested(state: SceneState, attackerId: string, targetId: string): SceneState {
  const rest = (c: CampaignCharacter): CampaignCharacter => ({ ...c, resources: { ...c.resources, AP: REST_AP, surgeAP: 0, STA: getSTA(c) } })
  return { ...state, characters: { ...state.characters, [attackerId]: rest(state.characters[attackerId]), [targetId]: rest(state.characters[targetId]) } }
}

// The distribution over the attacker's die is the weight of an estimate and
// nothing here reads it again.
function slim(e: AttackEstimate): AttackEstimate {
  const answers = e.defenses.map((d) => ({ ...d, byDie: [] }))
  return { ...e, defenses: answers, guarded: { ...e.guarded, byDie: [] } }
}

export function evaluate(store: Evaluations, state: SceneState, attackerId: string, targetId: string): AttackEstimate[] {
  if (!state.characters[attackerId] || !state.characters[targetId]) return []
  const key = getEvaluationKey(state, attackerId, targetId)
  return (store[key] ??= estimateAttacks(rested(state, attackerId, targetId), attackerId, targetId).map(slim))
}

// The attacks the attacker can pay for now, each against the answers the
// target can pay for now.
export function getStanding(store: Evaluations, state: SceneState, attackerId: string, targetId: string): AttackEstimate[] {
  const attacker = state.characters[attackerId]
  const target = state.characters[targetId]
  if (!attacker || !target) return []
  return evaluate(store, state, attackerId, targetId)
    .filter((e) => canAfford(attacker, e.cost))
    .map((e) => guardedBy(e, e.defenses.filter((d) => d.kind === 'none' || canAfford(target, d.cost))))
}

export function getBestAttack(store: Evaluations, state: SceneState, attackerId: string, targetId: string): AttackEstimate | null {
  return rankAttacks(getStanding(store, state, attackerId, targetId))[0] ?? null
}
