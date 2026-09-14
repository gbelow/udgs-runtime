import { describe, it, expect } from 'vitest'
import * as characterCommands from './character/commands'
import * as itemCommands from './item/commands'
import * as nextRoundModule from './combat/commands/nextRound'
import * as resetCombatModule from './combat/commands/resetCombat'
import * as startTurnModule from './combat/commands/startTurn'
import { CombatStateSchema, type CombatState } from './combat/types'
import { makeCampaignCharacter } from './factories'
import { getAttacksList } from './character/lenses/gear'
import { ArmorSchema, ContainerSchema, ItemSchema, WeaponSchema } from './types'
import type { CampaignCharacter } from './types'
import armorsCatalog from '../assets/armors.json'
import weaponsCatalog from '../assets/weapons.json'

const combatCommands = { ...nextRoundModule, ...resetCombatModule, ...startTurnModule }

// Every command in the domain is a pure updater — `(subject) => subject` — and
// the subject it is handed comes back untouched. That is the property the whole
// state layer rests on: a store can keep the previous value, compare by
// reference, and re-render exactly what changed.
//
// The subject is deep frozen, so a command that writes through to it throws
// (modules are strict) instead of quietly succeeding, and the pristine clone
// catches any write the freeze cannot reach.

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

const armor = ArmorSchema.parse((armorsCatalog as Record<string, unknown>).Gambeson)
const dagger = WeaponSchema.parse((weaponsCatalog as Record<string, unknown>).Dagger)
const daggerItem = ItemSchema.parse({ name: 'Dagger', type: 'weapon', refId: 'Dagger', bulk: 0 })
const coin = ItemSchema.parse({ name: 'Coin', bulk: 0, amount: 5 })

function characterSubject(): CampaignCharacter {
  const base = makeCampaignCharacter({})
  const withKnowledge = characterCommands.addKnowledge('medicine')(base) as CampaignCharacter
  return {
    ...withKnowledge,
    armor,
    hands: [{ ...base.hands[0], itemId: daggerItem.id }, base.hands[1]],
    held: [daggerItem],
    containers: { belt: ContainerSchema.parse({ name: 'Belt', kind: 'belt', slots: { quick: { numSlots: 4, slotBulk: 1, items: [coin] } } }) },
    abilities: ['sprinter-1', 'synesthesia-1', 'tackle'],
    spells: { sleep: { method: 'intuitive', practice: 1 }, darken: { method: 'wizard', practice: 0 } },
    afflictions: ['prone'],
    injuries: { ...base.injuries, injuryLevel: 12, hemorrhage: 2, potion: 3 },
    resources: { AP: 6, STA: 10, hunger: 3, thirst: 3, exhaustion: 3 },
  }
}

const attack = getAttacksList({ atk: dagger.attacks[0] })(characterSubject())[0]

// Keyed by the export name so the completeness check below can tell a command
// that has no purity case from one that is deliberately not an updater.
const characterCases: Record<string, (c: CampaignCharacter) => unknown> = {
  heal: characterCommands.heal(4),
  updateIL: characterCommands.updateIL(0),
  bleed: characterCommands.bleed(2),
  updateSTA: characterCommands.updateSTA(1),
  addAffliction: characterCommands.addAffliction('blind'),
  restCharacter: characterCommands.restCharacter,
  actionSurge: characterCommands.actionSurge('focus'),
  equipArmor: characterCommands.equipArmor(armor),
  unequipArmor: characterCommands.unequipArmor(),
  putGauntlets: characterCommands.putGauntlets,
  putHelm: characterCommands.putHelm,
  resetSkill: characterCommands.resetSkill('strike'),
  resetAllSkills: characterCommands.resetAllSkills(),
  addKnowledge: characterCommands.addKnowledge('navigation'),
  removeKnowledge: characterCommands.removeKnowledge('medicine'),
  learnAbility: characterCommands.learnAbility('sprinter-2'),
  forgetAbility: characterCommands.forgetAbility('sprinter-1'),
  toggleAbility: characterCommands.toggleAbility('synesthesia-1'),
  useAbility: characterCommands.useAbility('tackle'),
  learnSpell: characterCommands.learnSpell('charm', 'intuitive'),
  forgetSpell: characterCommands.forgetSpell('sleep'),
  practiceSpell: characterCommands.practiceSpell('sleep', 1),
  castSpell: characterCommands.castSpell('darken'),
  suffocate: (c) => characterCommands.suffocate({ ...c, afflictions: ['suffocating'] }),
  payUpkeep: (c) => characterCommands.payUpkeep(characterCommands.toggleAbility('synesthesia-1')(c) as CampaignCharacter),
  spendAttackResources: characterCommands.spendAttackResources(attack),
}

const itemCases: Record<string, (c: CampaignCharacter) => unknown> = {
  duplicateItem: (c) => itemCommands.duplicateItem(c.containers.belt.slots.quick.items[0], { amount: 2 }),
  addItemToContainer: itemCommands.addItemToContainer('belt', 'quick', ItemSchema.parse({ name: 'Ration', bulk: 1 })),
  removeItemFromContainer: (c) => itemCommands.removeItemFromContainer('belt', c.containers.belt.slots.quick.items[0].id)(c),
  equipContainer: itemCommands.equipContainer('pack', ContainerSchema.parse({ name: 'Backpack', kind: 'backpack' })),
  unequipContainer: itemCommands.unequipContainer('belt'),
  holdItem: itemCommands.holdItem(ItemSchema.parse({ name: 'Torch', bulk: 1 })),
  regripItem: itemCommands.regripItem(daggerItem.id, 2),
  drawItem: (c) => itemCommands.drawItem('belt', c.containers.belt.slots.quick.items[0].id)(c),
  storeItem: itemCommands.storeItem(daggerItem.id, 'belt', 'quick'),
  dropItem: itemCommands.dropItem(daggerItem.id),
}

// Read projections, not updaters: they take a character and return a value
// rather than a character, so there is nothing for them to mutate.
const NOT_UPDATERS = new Set(['getAttackValues'])

const combatCases: Record<string, (s: CombatState) => unknown> = {
  nextRound: combatCommands.nextRound,
  resetCombat: combatCommands.resetCombat,
  startTurn: combatCommands.startTurn,
}

function combatSubject(): CombatState {
  const fighter = { ...characterSubject(), id: 'a' }
  return {
    ...CombatStateSchema.parse({}),
    characters: { a: fighter },
    activeCharacterId: 'a',
    round: 3,
  }
}

describe('commands are pure updaters', () => {
  it.each(Object.entries({ ...characterCases, ...itemCases }))('%s leaves its character alone', (_name, run) => {
    const subject = characterSubject()
    const pristine = structuredClone(subject)
    run(deepFreeze(subject))
    expect(subject).toEqual(pristine)
  })

  it.each(Object.entries(combatCases))('%s leaves its combat state alone', (_name, run) => {
    const subject = combatSubject()
    const pristine = structuredClone(subject)
    run(deepFreeze(subject))
    expect(subject).toEqual(pristine)
  })
})

// The point of keying the cases by export name: a command added to one of the
// command modules inherits the purity check, and fails here until it is given
// a subject to run against.
describe('every command is covered', () => {
  it.each([
    ['character', characterCommands, characterCases],
    ['item', itemCommands, itemCases],
    ['combat', combatCommands, combatCases],
  ] as const)('%s commands all have a purity case', (_family, module, cases) => {
    const uncovered = Object.entries(module)
      .filter(([name, value]) => typeof value === 'function' && !(name in cases) && !NOT_UPDATERS.has(name))
      .map(([name]) => name)
    expect(uncovered).toEqual([])
  })
})
