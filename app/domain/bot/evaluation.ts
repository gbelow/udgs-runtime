import type { CampaignCharacter } from '../types'
import type { SceneState } from '../scene/types'
import { setDistance } from '../scene/rules/board/geometry'
import weapons from '../../assets/weapons.json'
import armors from '../../assets/armors.json'
import ammo from '../../assets/ammo.json'
import items from '../../assets/items.json'
import containers from '../../assets/containers.json'
import abilities from '../../assets/abilities.json'

// What an attack comes to is a property of the two characters and the gap
// between them, not of how much AP and STA they happen to hold. A reading is
// therefore kept under what it was made of: everything either carries but its
// resources and the surge it has used, the distance between them, the grapples
// they are in and the catalogs the gear is read from.

// What the catalogs say, as a short hash: a character stores which item it holds,
// and the numbers an attack comes to are read from the catalog when it is asked.
function fingerprint(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(36)
}

const CATALOGS = fingerprint(JSON.stringify([weapons, armors, ammo, items, containers, abilities]))

// what a face shows of the resources (`shown`) goes with them
const NOT_CARRIED: readonly string[] = ['resources', 'usedSurge', 'surgeFloor', 'shown']
const NOT_HARM: readonly string[] = [...NOT_CARRIED, 'injuries', 'afflictions']

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

// A character and each part of it are replaced, never changed, so the text of
// a part is made once and shared by every character that keeps that part.
const partTexts = new WeakMap<object, string>()

function partText(value: unknown): string {
  if (!value || typeof value !== 'object') return canonical(value)
  const known = partTexts.get(value)
  if (known !== undefined) return known
  const text = canonical(value)
  partTexts.set(value, text)
  return text
}

// The character as text, but for the parts `leftOut` names.
function textWithout(memo: WeakMap<CampaignCharacter, string>, leftOut: readonly string[]): (c: CampaignCharacter) => string {
  return (c) => {
    const known = memo.get(c)
    if (known !== undefined) return known
    const parts = c as unknown as Record<string, unknown>
    const text = `{${Object.keys(parts).filter((k) => !leftOut.includes(k) && parts[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${partText(parts[k])}`).join(',')}}`
    memo.set(c, text)
    return text
  }
}

const carriedText = textWithout(new WeakMap(), NOT_CARRIED)
const harmText = textWithout(new WeakMap(), NOT_HARM)

// What decides how much harm an attack does at each overflow, whatever the gap
// between the two, the resources they hold, the DL it is made against (a part of
// the reading's own key) or how hurt the target is: everything either carries
// but the injuries and the afflictions, bar what is known to reach the harm: the
// wounds already on each, the injury level of each once it has reached its injury
// threshold, and a target lying prone. Checked by trying every affliction and
// every injury on each of the two, and by reading the same tables with the full
// key in a fight.
function forHarm(c: CampaignCharacter, attacker: boolean): string {
  const { injuries, afflictions } = c
  return `${harmText(c)} ${partText(injuries.wounds)} ${injuries.injuryLevel >= injuries.injuryThreshold ? injuries.injuryLevel : 0} ${!attacker && afflictions.includes('prone')}`
}

function bindsOf(state: SceneState, attackerId: string, targetId: string): string {
  const pair = [attackerId, targetId]
  return canonical(state.binds.filter((b) => b.members.some((m) => pair.includes(m))))
}

export function getPairKey(state: SceneState, attackerId: string, targetId: string): string {
  return [
    forHarm(state.characters[attackerId], true),
    forHarm(state.characters[targetId], false),
    bindsOf(state, attackerId, targetId),
    CATALOGS,
  ].join(' | ')
}

export function getEvaluationKey(state: SceneState, attackerId: string, targetId: string): string {
  return [
    carriedText(state.characters[attackerId]),
    carriedText(state.characters[targetId]),
    gapBetween(state, attackerId, targetId),
    bindsOf(state, attackerId, targetId),
    CATALOGS,
  ].join(' | ')
}
