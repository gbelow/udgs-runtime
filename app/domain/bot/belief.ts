import { ContainerSchema, ItemSchema, type AmmoKind, type CampaignCharacter, type Container, type Item } from '../types'
import type { SceneState } from '../scene/types'
import { getSceneSeenBy } from '../scene/projections/seen'
import { FACE_KEYS, fillThird } from '../character/lenses/face'
import { getSTA } from '../character/rules/characteristics'
import { ROUND_AP } from '../tables'
import { getWieldedWeapons } from '../item/rules/hands'
import { getItemScale } from '../item/rules/items'
import ammoCatalog from '../../assets/ammo.json'
import type { Party } from './party'

// The fight as a bot weighs it: what a player in its place would see of it
// (multiplayer-plan.md "Hidden information", `getSceneSeenBy`): the sheets
// of the characters of its owner (the party's members) in full, and of
// everyone else it sees, allies played by someone else among them, a face,
// with a guess at what the face (`getPublicFace`) does not show.
// The table's ruling: a foe is taken to be as good as the character looking
// at it, with its characteristics, skills and abilities, holding and wearing
// what the foe is seen to, as hurt as it is seen to be, with the most AP and
// STA of its own that the third it is seen to have left could hold, and with
// a full quiver for every weapon it holds that shoots.

// What the face shows, and what a fight puts on a character, which the face
// shows as far as it shows anything.
const SHOWN = [...FACE_KEYS, 'shown', 'injuries', 'afflictions', 'resources', 'usedSurge', 'surgeFloor', 'runsFree', 'rallied', 'steeled', 'active', 'pending'] as const

// gear.tex "Quiver": "carries 20 arrows or bolts".
const QUIVER = 20

const QUIVER_KEY = 'guessed quiver'

function ammoOf(kind: AmmoKind, scale: number): Item | null {
  const refId = Object.entries(ammoCatalog).find(([, entry]) => entry.kind === kind)?.[0]
  if (!refId) return null
  const item = ItemSchema.parse({ id: `${QUIVER_KEY} ${kind} ${scale}`, name: refId, type: 'ammo', refId, bulk: 0, amount: QUIVER })
  return { ...item, bulk: scale - getItemScale(item) }
}

// A quiver of the first arrow or bolt the catalog has for each weapon the
// character holds that shoots, made for that weapon's size.
function quiversFor(c: CampaignCharacter): Record<string, Container> {
  const needed = new Map<string, { kind: AmmoKind; scale: number }>()
  for (const { weapon } of getWieldedWeapons(c)) {
    for (const atk of weapon.attacks) if (atk.ammo) needed.set(`${atk.ammo} ${weapon.scale}`, { kind: atk.ammo, scale: weapon.scale })
  }
  const items = [...needed.values()].flatMap(({ kind, scale }) => ammoOf(kind, scale) ?? [])
  return items.length === 0 ? {} : { [QUIVER_KEY]: ContainerSchema.parse({ name: QUIVER_KEY, slots: { quick: { numSlots: items.length, items } } }) }
}

function guess(looker: CampaignCharacter, face: CampaignCharacter): CampaignCharacter {
  const shown = Object.fromEntries(SHOWN.map((key) => [key, face[key]])) as Partial<CampaignCharacter>
  const guessed: CampaignCharacter = { ...looker, ...shown }
  const thirds = face.shown ?? { AP: 2, STA: 2 }
  const resources = { ...guessed.resources, AP: fillThird(thirds.AP, ROUND_AP), STA: fillThird(thirds.STA, getSTA(guessed)) }
  return { ...guessed, resources, containers: quiversFor(guessed) }
}

// The fight as `lookerId`, of `party`, takes it to stand.
export function getBelief(state: SceneState, party: Party, lookerId: string): SceneState {
  const seen = getSceneSeenBy(state, new Set(party.members))
  const looker = seen.characters[lookerId]
  if (!looker) return seen
  const characters = Object.fromEntries(Object.entries(seen.characters).map(([id, c]) =>
    [id, party.members.includes(id) ? c : guess(looker, c)]))
  return { ...seen, characters }
}
