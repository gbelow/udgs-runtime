import { describe, it, expect } from 'vitest'
import { makeCharacter, makeCampaignCharacter } from './factories'
import { isBaseCharacter, isCampaignCharacter } from './utils'
import { BaseCharacterSchema, CampaignCharacterSchema, ContainerSchema, ItemSchema } from './types'
import armorsCatalog from '../assets/armors.json'

// Ingestion is the domain's only door to the outside — saved JSON files, Redis
// documents, hand-edited assets — so what matters is that it is total, that it
// keeps nothing it cannot vouch for, and that a character survives the trip
// through the format it is stored in.

// `unvalidated` marks an input the ingest is known to let through in a shape
// its own schema rejects. Kept in the list rather than dropped from it.
const HOSTILE: { label: string; raw: unknown; unvalidated?: boolean }[] = [
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
  { label: 'hands that are not a list', raw: { hands: 'two' } },
  { label: 'a malformed hand', raw: { hands: [{ canHold: 'yes' }] } },
  { label: 'a malformed held item', raw: { held: [{ bulk: 'big' }] } },
  // knowledges are ingested as `z.any()` into an open record and merged raw, so
  // a malformed entry still reaches the character unchecked.
  { label: 'a wrongly-typed knowledge', raw: { knowledges: { medicine: { value: 'lots' } } }, unvalidated: true },
  { label: 'afflictions that are not a list', raw: { type: 'campaign', afflictions: 'all of them' } },
  { label: 'unreadable movement values', raw: { movement: { basic: 'fast', run: NaN } } },
]

const populated = () =>
  makeCharacter({
    name: 'Ana',
    tags: ['party', 'front line'],
    size: 4,
    TGH: 2,
    notes: 'kept',
    abilities: ['sprinter-1', 'synesthesia-1'],
    trainables: { STR: { value: 15 }, strike: { value: 4 } },
    armor: (armorsCatalog as Record<string, unknown>).Hauberk,
    hands: [{ name: 'left', naturalWeapon: 'Unarmed', canHold: true, itemId: 'dagger-1' }, { name: 'right', naturalWeapon: 'Unarmed', canHold: true, itemId: '' }],
    held: [ItemSchema.parse({ id: 'dagger-1', name: 'Dagger', type: 'weapon', refId: 'Dagger', bulk: 0 })],
    containers: {
      belt: ContainerSchema.parse({
        name: 'Belt',
        kind: 'belt',
        slots: { quick: { numSlots: 4, slotBulk: 1, items: [ItemSchema.parse({ name: 'Coin', amount: 5 })] } },
      }),
    },
  })

describe('ingestion is total', () => {
  for (const { label, raw, unvalidated } of HOSTILE) {
    const run = unvalidated ? it.fails : it

    run(`${label} yields a valid base character`, () => {
      const c = makeCharacter(raw)
      expect(isBaseCharacter(c)).toBe(true)
      expect(BaseCharacterSchema.parse(c)).toEqual(c)
    })

    run(`${label} yields a valid campaign character`, () => {
      const c = makeCampaignCharacter(raw)
      expect(isCampaignCharacter(c)).toBe(true)
      expect(CampaignCharacterSchema.parse(c)).toEqual(c)
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

  it('round-trips a campaign character through JSON', () => {
    const c = makeCampaignCharacter({
      ...populated(),
      type: 'campaign',
      afflictions: ['prone'],
      active: [{ kind: 'ability', key: 'synesthesia-1' }],
      resources: { AP: 4, STA: 8, hunger: 3, thirst: 2, exhaustion: 1 },
      injuries: { injuryLevel: 12, wounds: [], hemorrhage: 2, potion: 0, injuryThreshold: 10, unconsciousThreshold: 40, deathThreshold: 50 },
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
