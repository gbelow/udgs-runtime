import { AttributesSchema, ContainerSchema, ItemSchema, type AmmoKind, type Attributes, type CampaignCharacter, type Container, type Grant, type Item } from '../types'
import { ABILITIES, ABILITY_FAMILY_OF, ABILITY_KEYS, heldAbility, isAbilityKey, type AbilityKey } from '../abilities'
import type { SceneState } from '../scene/types'
import { getSceneSeenBy } from '../scene/projections/seen'
import { fillThird } from '../character/lenses/face'
import { characteristicLenses, skillLenses } from '../character/lenses'
import { getSTA } from '../character/rules/characteristics'
import { ROUND_AP, SURGES } from '../tables'
import { getWieldedWeapons } from '../item/rules/hands'
import ammoCatalog from '../../assets/ammo.json'

// The fight as a bot weighs it: what a player in its place would see of it
// (multiplayer-plan.md "Hidden information", `getSceneSeenBy`): the sheets
// of the characters of its owner (the party's members) in full, and of
// everyone else it sees, allies played by someone else among them, a face,
// with a guess at what the face (`getPublicFace`) does not show.
// The table's ruling: what a foe's face does not show is known only by
// ballpark, and the same whichever member of the party is looking. Its
// attributes and its skills are each its real value rounded down to a multiple
// of 3; of its talents and proficiencies nothing is known, so they stay as an
// empty sheet has them, and of its abilities only those the party has seen it
// use in the fight, with what each requires, and Archer, which every fighter
// is taken to have (the user's ruling). It holds and wears what it is seen to, is as
// hurt as it is seen to be, has the most AP and STA of its own that the third it
// is seen to have left could hold, and a full quiver for every weapon it holds
// that shoots.

// gear.tex "Quiver": "carries 20 arrows or bolts".
const QUIVER = 20

const QUIVER_KEY = 'guessed quiver'

function ammoOf(kind: AmmoKind, scale: number): Item | null {
  const refId = Object.entries(ammoCatalog).find(([, entry]) => entry.kind === kind)?.[0]
  if (!refId) return null
  return ItemSchema.parse({ id: `${QUIVER_KEY} ${kind} ${scale}`, name: refId, type: 'ammo', refId, bulk: 0, ammo: { scale }, amount: QUIVER })
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

// The abilities first, as the attributes and skills are set through what they
// add.
function guess(face: CampaignCharacter, real: CampaignCharacter | undefined, abilities: AbilityKey[]): CampaignCharacter {
  const able = abilities.length > 0 ? { ...face, abilities: abilitiesOf(abilities) } : face
  const known = real ? ballparked(able, real) : able
  const thirds = face.shown ?? { AP: 2, STA: 2 }
  const resources = { ...known.resources, AP: fillThird(thirds.AP, ROUND_AP), STA: fillThird(thirds.STA, getSTA(known)) }
  return { ...known, resources, containers: quiversFor(known) }
}

// The ability a recipe is learned with, by the recipe's id (`<ability>.<n>`);
// null for a recipe every fighter has.
function abilityOfRecipe(id: string | null): AbilityKey | null {
  const key = id?.split('.')[0]
  return key && isAbilityKey(key) ? key : null
}

// The lowest stage that gives the grant, when a single family does: seen in
// use, it could be any family that gives it.
function grantedBy(grant: Grant): AbilityKey[] {
  const giving = ABILITY_KEYS.filter((key) => ABILITIES[key].grants.includes(grant))
  const families = new Set(giving.map((key) => ABILITY_FAMILY_OF[key]))
  return families.size === 1 ? giving.slice(0, 1) : []
}

// The abilities and with them every one each requires.
function withRequired(keys: AbilityKey[]): AbilityKey[] {
  const known = new Set<AbilityKey>()
  const add = (key: AbilityKey): void => {
    if (known.has(key)) return
    known.add(key)
    ABILITIES[key].requires.filter(isAbilityKey).forEach(add)
  }
  keys.forEach(add)
  return [...known]
}

// The abilities the party has seen the character use in the fight as it is
// shown them (`getSceneSeenBy`): the recipe an action it saw was made under or
// carried the trades of, and a surge only an ability gives, with every ability
// these require.
export function getSeenAbilities(seen: SceneState, id: string): AbilityKey[] {
  const actions = [...Object.values(seen.actions), ...seen.journal.map((entry) => entry.action)].filter((a) => a.actorId === id)
  const recipes = actions.flatMap((a) => [a.recipe, ...a.learnedModifiers].flatMap((r) => abilityOfRecipe(r) ?? []))
  const surges = [seen.characters[id]?.usedSurge, ...actions.map((a) => a.surged?.kind)]
  const learned = new Set(surges.flatMap((kind) => (kind ? (SURGES[kind] as { learned?: Grant }).learned ?? [] : [])))
  return withRequired([...recipes, ...[...learned].flatMap(grantedBy)])
}

// The abilities as a sheet holds them: each family at the highest stage known.
function abilitiesOf(keys: AbilityKey[]): CampaignCharacter['abilities'] {
  const levels = new Map<string, number>()
  for (const key of keys) levels.set(ABILITY_FAMILY_OF[key], Math.max(levels.get(ABILITY_FAMILY_OF[key]) ?? 0, ABILITIES[key].stage))
  return Object.fromEntries([...levels].map(([family, level]) => [family, heldAbility(family, level)]))
}

// A face and the sheet behind it are replaced, never changed, so the guess at
// one is made once for the abilities seen.
const guesses = new WeakMap<CampaignCharacter, WeakMap<CampaignCharacter, Map<string, CampaignCharacter>>>()

function guessOnce(face: CampaignCharacter, real: CampaignCharacter | undefined, abilities: AbilityKey[]): CampaignCharacter {
  if (!real) return guess(face, real, abilities)
  const byFace = guesses.get(real) ?? new WeakMap<CampaignCharacter, Map<string, CampaignCharacter>>()
  guesses.set(real, byFace)
  const bySeen = byFace.get(face) ?? new Map<string, CampaignCharacter>()
  byFace.set(face, bySeen)
  const key = [...abilities].sort().join(' ')
  const known = bySeen.get(key)
  if (known) return known
  const made = guess(face, real, abilities)
  bySeen.set(key, made)
  return made
}

// The abilities every face is taken to have, seen used or not (the user's ruling).
const ASSUMED: AbilityKey[] = ['archer']

// The fight as `lookerId`, one of `members` (the characters one owner plays), takes it to stand.
export function getBelief(state: SceneState, members: readonly string[], lookerId: string): SceneState {
  const seen = getSceneSeenBy(state, new Set(members))
  if (!seen.characters[lookerId]) return seen
  const characters = Object.fromEntries(Object.entries(seen.characters).map(([id, c]) =>
    [id, members.includes(id) ? c : guessOnce(c, state.characters[id], [...ASSUMED, ...getSeenAbilities(seen, id)])]))
  return { ...seen, characters }
}
