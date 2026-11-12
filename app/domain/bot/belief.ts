import { AttributesSchema, ContainerSchema, ItemSchema, type AmmoKind, type Attributes, type CampaignCharacter, type Container, type Item } from '../types'
import type { SceneState } from '../scene/types'
import { getSceneSeenBy } from '../scene/projections/seen'
import { fillThird } from '../character/lenses/face'
import { characteristicLenses, skillLenses } from '../character/lenses'
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
// The table's ruling: what a foe's face does not show is known only by
// ballpark, and the same whichever member of the party is looking. Its
// attributes and its skills are each its real value rounded down to a multiple
// of 3; of its talents, proficiencies and abilities nothing is known, so they
// stay as an empty sheet has them. It holds and wears what it is seen to, is as
// hurt as it is seen to be, has the most AP and STA of its own that the third it
// is seen to have left could hold, and a full quiver for every weapon it holds
// that shoots.

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

// How close the bot knows an attribute or a skill: the multiple of this at or below it.
const BALLPARK = 3

const ballpark = (value: number) => Math.floor(value / BALLPARK) * BALLPARK

const ATTRIBUTES = Object.keys(AttributesSchema.shape) as (keyof Attributes)[]
const SKILLS = Object.keys(skillLenses) as (keyof typeof skillLenses)[]

// The attributes first, as the skills are worked out from them.
function ballparked(face: CampaignCharacter, real: CampaignCharacter): CampaignCharacter {
  const attributed = ATTRIBUTES.reduce<CampaignCharacter>((c, key) => characteristicLenses[key].set(c, ballpark(characteristicLenses[key].get(real))) as CampaignCharacter, face)
  return SKILLS.reduce<CampaignCharacter>((c, key) => skillLenses[key].set(c, ballpark(skillLenses[key].get(real))) as CampaignCharacter, attributed)
}

function guess(face: CampaignCharacter, real: CampaignCharacter | undefined): CampaignCharacter {
  const known = real ? ballparked(face, real) : face
  const thirds = face.shown ?? { AP: 2, STA: 2 }
  const resources = { ...known.resources, AP: fillThird(thirds.AP, ROUND_AP), STA: fillThird(thirds.STA, getSTA(known)) }
  return { ...known, resources, containers: quiversFor(known) }
}

// A face and the sheet behind it are replaced, never changed, so the guess at
// one is made once.
const guesses = new WeakMap<CampaignCharacter, WeakMap<CampaignCharacter, CampaignCharacter>>()

function guessOnce(face: CampaignCharacter, real: CampaignCharacter | undefined): CampaignCharacter {
  if (!real) return guess(face, real)
  const byFace = guesses.get(real) ?? new WeakMap<CampaignCharacter, CampaignCharacter>()
  guesses.set(real, byFace)
  const known = byFace.get(face)
  if (known) return known
  const made = guess(face, real)
  byFace.set(face, made)
  return made
}

// The fight as `lookerId`, of `party`, takes it to stand.
export function getBelief(state: SceneState, party: Party, lookerId: string): SceneState {
  const seen = getSceneSeenBy(state, new Set(party.members))
  if (!seen.characters[lookerId]) return seen
  const characters = Object.fromEntries(Object.entries(seen.characters).map(([id, c]) =>
    [id, party.members.includes(id) ? c : guessOnce(c, state.characters[id])]))
  return { ...seen, characters }
}
