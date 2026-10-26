import { describe, it, expect } from 'vitest'
import { copyAsBase, copyIntoPlay, makeCharacter, makeCampaignCharacter, makeRace } from './factories'
import { isBaseCharacter, isCampaignCharacter } from './utils'
import { getSTA } from './character/rules/characteristics'
import { BaseCharacterSchema, CampaignCharacterSchema, ContainerSchema, ItemSchema, RaceSchema } from './types'
import { holdsPart, isSoundFootprint } from './character/rules/footprint'
import armorsCatalog from '../assets/armors.json'

// Ingestion is the domain's only door to the outside — saved JSON files, Redis
// documents, hand-edited assets — so what matters is that it is total, that it
// keeps nothing it cannot vouch for, and that a character survives the trip
// through the format it is stored in.

const HOSTILE: { label: string; raw: unknown }[] = [
  { label: 'null', raw: null },
  { label: 'undefined', raw: undefined },
  { label: 'a number', raw: 42 },
  { label: 'a string', raw: 'not a character' },
  { label: 'a boolean', raw: true },
  { label: 'an array', raw: [] },
  { label: 'an empty object', raw: {} },
  { label: 'a wrongly-typed name', raw: { name: 42 } },
  { label: 'a wrongly-typed size', raw: { size: 'big' } },
  { label: 'trainables that are not a map', raw: { trainables: 'nope' } },
  { label: 'a wrongly-typed trainable', raw: { trainables: { STR: 'strong', bogus: { value: 1 } } } },
  { label: 'a null armor', raw: { armor: null } },
  { label: 'containers that are not a map', raw: { containers: 3 } },
  { label: 'a body that is not a list', raw: { body: 'two' } },
  { label: 'a malformed body part', raw: { body: [{ grip: 'yes' }] } },
  { label: 'a malformed held item', raw: { held: [{ bulk: 'big' }] } },
  { label: 'a wrongly-typed legacy knowledge', raw: { knowledges: { medicine: { value: 'lots' }, 'the old town': 'well' } } },
  { label: 'a wrongly-typed specific knowledge', raw: { specificKnowledges: { 'the old town': { value: 'lots' }, medicine: 2 } } },
  { label: 'afflictions that are not a list', raw: { type: 'campaign', afflictions: 'all of them' } },
  { label: 'unreadable movement values', raw: { movement: { basic: 'fast', run: NaN } } },
  { label: 'a race draft that is not an object', raw: { raceDraft: 'human' } },
  { label: 'a malformed race draft', raw: { raceDraft: { name: 3, bonuses: { STR: 'lots', bogus: 2 }, abilities: [1, 'fur'] } } },
  { label: 'a malformed part wound', raw: { body: [{ location: 'hand', wounds: [{ tier: 'high' }] }] } },
  { label: 'abilities saved as a list', raw: { abilities: ['sprinter-1'] } },
  { label: 'a malformed ability', raw: { abilities: { sprinter: 'yes', tail: { value: 'two' } } } },
  { label: 'a footprint that is not a list', raw: { footprint: 'three' } },
  { label: 'a footprint in two pieces', raw: { size: 5, footprint: [{ q: 0, r: 0 }, { q: 2, r: 0 }] } },
  { label: 'a footprint without its anchor', raw: { footprint: [{ q: 1, r: 0 }] } },
  { label: 'a footprint of half cells', raw: { footprint: [{ q: 0, r: 0 }, { q: 0.5, r: 0 }] } },
  { label: 'a part on a cell the footprint does not cover', raw: { footprint: [{ q: 0, r: 0 }, { q: 1, r: 0 }], body: [{ location: 'head', cell: { q: 3, r: 3 } }] } },
  { label: 'a malformed part cell', raw: { body: [{ location: 'head', cell: 'front' }] } },
]

const populated = () =>
  makeCharacter({
    name: 'Ana',
    tags: ['party', 'front line'],
    size: 4,
    TGH: 2,
    notes: 'kept',
    abilities: { sprinter: { value: 1 }, synesthesia: { value: 1, XP: 3 } },
    trainables: { STR: { value: 15 }, strike: { value: 4 } },
    armor: (armorsCatalog as Record<string, unknown>).Hauberk,
    body: [{ id: 'left', name: 'left', location: 'hand', naturalWeapon: 'Unarmed', grip: true, itemId: 'dagger-1' }, { id: 'right', name: 'right', location: 'hand', naturalWeapon: 'Unarmed', grip: true, itemId: '' }],
    held: [ItemSchema.parse({ id: 'dagger-1', name: 'Dagger', type: 'weapon', refId: 'Dagger', bulk: 1 })],
    containers: {
      belt: ContainerSchema.parse({
        name: 'Belt',
        kind: 'belt',
        slots: { quick: { numSlots: 4, slotBulk: 2, items: [ItemSchema.parse({ name: 'Coin', bulk: 0, amount: 4 })] } },
      }),
    },
  })

describe('ingestion is total', () => {
  // A campaign character saved before `exhaustion` existed came back with the
  // partial resources record it was saved with, and every cost paid from it
  // went NaN.
  it('lands a partial resources record on a complete one', () => {
    const c = makeCampaignCharacter({ resources: { STA: 20, AP: 8 } })
    expect(CampaignCharacterSchema.parse(c).resources).toEqual(c.resources)
    expect(c.resources).toMatchObject({ STA: 20, AP: 8 })
  })

  // The fix for the case above merged the raw through the schema, whose
  // defaults then overrode the full-STA start of a character with no
  // resources block at all.
  it('starts a character with no resources block at full STA', () => {
    const c = makeCampaignCharacter({})
    expect(c.resources.STA).toBe(getSTA(c))
  })

  // Abilities were saved as a list of stage keys before they became family
  // trainables; that field is lost, not the character around it.
  it('drops abilities saved as a list and keeps the rest', () => {
    const c = makeCharacter({ name: 'Ana', abilities: ['sprinter-1'], trainables: { STR: { value: 15 } } })
    expect(c.abilities).toEqual({})
    expect(c.name).toBe('Ana')
    expect(c.trainables.STR.value).toBe(15)
  })

  for (const { label, raw } of HOSTILE) {
    it(`${label} yields a valid base character`, () => {
      const c = makeCharacter(raw)
      expect(isBaseCharacter(c)).toBe(true)
      expect(BaseCharacterSchema.parse(c)).toEqual(c)
    })

    it(`${label} yields a valid campaign character`, () => {
      const c = makeCampaignCharacter(raw)
      expect(isCampaignCharacter(c)).toBe(true)
      expect(CampaignCharacterSchema.parse(c)).toEqual(c)
    })

    it(`${label} yields a footprint in one piece around the anchor, holding every part`, () => {
      for (const c of [makeCharacter(raw), makeCampaignCharacter(raw)]) {
        expect(isSoundFootprint(c.footprint)).toBe(true)
        expect(c.body.every((part) => holdsPart(c.footprint, part))).toBe(true)
      }
    })
  }
})

describe('makeCharacter defaults to its schema', () => {
  // The empty character is the schema's own defaults and nothing else, so the
  // defaults live in one place rather than being restated here.
  it('fills an unreadable input with exactly the schema defaults', () => {
    const c = makeCharacter(null)
    expect({ ...c, id: '' }).toEqual({ ...BaseCharacterSchema.parse({}), id: '' })
  })

  it('keeps what it recognizes and defaults the rest', () => {
    const c = makeCharacter({ name: 'Ana', trainables: { strike: { value: 4 } } })
    const empty = makeCharacter(null)
    expect(c.name).toBe('Ana')
    expect(c.trainables.strike.value).toBe(4)
    expect({ ...c.trainables, strike: null }).toEqual({ ...empty.trainables, strike: null })
  })

  it('keeps nothing it cannot vouch for', () => {
    const c = makeCharacter({ name: 'Ana', bogusField: 'nope', armor: { name: 'Plate', RES: 5, madeUp: 'x' } })
    expect((c as Record<string, unknown>).bogusField).toBeUndefined()
    expect((c.armor as Record<string, unknown>).madeUp).toBeUndefined()
    expect(c.armor.name).toBe('Plate')
  })
})

describe('ingestion settles in one pass', () => {
  it.each(HOSTILE.map((c) => [c.label, c.raw] as const))('%s settles in one pass', (_label, raw) => {
    const once = makeCharacter(raw)
    expect(makeCharacter(once)).toEqual(once)
  })

  it('is idempotent on a populated character', () => {
    const c = populated()
    expect(makeCharacter(c)).toEqual(c)
  })

  it('is idempotent for campaign characters', () => {
    const c = makeCampaignCharacter({ ...populated(), type: 'campaign' })
    expect(makeCampaignCharacter(c)).toEqual(c)
  })
})

// Base characters are stored as JSON files and campaign characters in Redis,
// so JSON is the shape every character has to survive being written in.
describe('a character survives its storage format', () => {
  it('round-trips a populated base character through JSON', () => {
    const c = populated()
    expect(makeCharacter(JSON.parse(JSON.stringify(c)))).toEqual(c)
  })

  // Loading a created character into the sheet dropped the gold creation
  // gave it, because ingestion strips what it has no entry for.
  it('keeps the starting wealth a created character carries', () => {
    expect(makeCharacter({ startingWealth: 3000 }).startingWealth).toBe(3000)
  })

  // The picture on a character's token never reached the board, because
  // ingestion strips what it has no entry for and token had none.
  it('keeps the token a character names, into a base copy and into play', () => {
    const raw = { token: '/tokens/knight.webp' }
    expect(makeCharacter(raw).token).toBe(raw.token)
    expect(makeCampaignCharacter(raw).token).toBe(raw.token)
    expect(copyIntoPlay(makeCharacter(raw), 'copy').token).toBe(raw.token)
  })

  it('round-trips a campaign character through JSON', () => {
    const c = makeCampaignCharacter({
      ...populated(),
      type: 'campaign',
      afflictions: ['prone'],
      active: [{ kind: 'ability', key: 'synesthesia-1' }],
      resources: { AP: 4, STA: 8, hunger: 3, thirst: 2, exhaustion: 1 },
      injuries: { injuryLevel: 12, bleed: 2, potion: 0, injuryThreshold: 10, unconsciousThreshold: 40, deathThreshold: 50 },
    })
    expect(makeCampaignCharacter(JSON.parse(JSON.stringify(c)))).toEqual(c)
  })

  it('gives every ingested item an id to be addressed by', () => {
    const c = makeCharacter({
      containers: { belt: { name: 'Belt', slots: { quick: { numSlots: 4, items: [{ name: 'Coin', amount: 5 }] } } } },
    })
    const [item] = c.containers.belt.slots.quick.items
    expect(item.id).toBeTruthy()
    expect(item.amount).toBe(5)
  })
})

// Races are stored as JSON files beside the characters and read the same way.
describe('a race survives its storage format', () => {
  for (const { label, raw } of HOSTILE) {
    it(`${label} yields a valid race`, () => {
      const race = makeRace(raw)
      expect(RaceSchema.parse(race)).toEqual(race)
      expect(makeRace(race)).toEqual(race)
    })
  }

  it('round-trips a populated race through JSON', () => {
    const race = makeRace({ name: 'Surbit', playable: true, size: 2, bonuses: { STR: 1, AGI: 2 }, abilities: ['fur', 'claws'], body: [{ id: 'tail', name: 'tail', location: 'other', aimPenalty: 5 }] })
    expect(makeRace(JSON.parse(JSON.stringify(race)))).toEqual(race)
  })
})

// A player character joined to two campaigns was one Redis record, so each
// campaign saved over the other's version of it.
describe('copies of a character kept apart', () => {
  it('a library character brought into two campaigns is two characters, and what play wrote on one stays on it', () => {
    const library = copyAsBase(makeCampaignCharacter({ name: 'Ada', resources: { STA: 1 } }), 'library')
    const first = copyIntoPlay(library, 'first')
    const second = copyIntoPlay(library, 'second')
    expect([library.id, first.id, second.id]).toEqual(['library', 'first', 'second'])
    expect(isBaseCharacter(library)).toBe(true)
    expect(isCampaignCharacter(first)).toBe(true)
    expect(first.resources.STA).not.toBe(1)
  })
})
