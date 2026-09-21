import { describe, it, expect } from 'vitest'
import * as characterCommands from './character/commands'
import * as itemCommands from './item/commands'
import * as nextRoundModule from './combat/commands/nextRound'
import * as resetCombatModule from './combat/commands/resetCombat'
import * as startTurnModule from './combat/commands/startTurn'
import * as actionsModule from './combat/commands/action'
import * as boardModule from './combat/commands/board'
import { CombatStateSchema, type CombatState } from './combat/types'
import { makeCampaignCharacter } from './factories'
import { ArmorSchema, ContainerSchema, ItemSchema } from './types'
import type { CampaignCharacter } from './types'
import armorsCatalog from '../assets/armors.json'

const combatCommands = { ...nextRoundModule, ...resetCombatModule, ...startTurnModule, ...actionsModule, ...boardModule }

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
const daggerItem = ItemSchema.parse({ name: 'Dagger', type: 'weapon', refId: 'Dagger', bulk: 1 })
const grenadeItem = ItemSchema.parse({ name: 'Grenade', type: 'weapon', refId: 'Grenade', bulk: 1 })
const coin = ItemSchema.parse({ name: 'Coin', bulk: 0, amount: 2 })
const gambeson = () => ItemSchema.parse({ name: 'Gambeson', type: 'armor', refId: 'Gambeson', bulk: 2 })
const packedGambeson = gambeson()

function characterSubject(): CampaignCharacter {
  const base = makeCampaignCharacter({})
  const withKnowledge = characterCommands.addKnowledge('medicine')(base) as CampaignCharacter
  return {
    ...withKnowledge,
    armor,
    worn: gambeson(),
    hands: [{ ...base.hands[0], itemId: daggerItem.id }, base.hands[1]],
    held: [daggerItem],
    containers: { belt: ContainerSchema.parse({ name: 'Belt', kind: 'belt', slots: { quick: { numSlots: 4, slotBulk: 2, items: [coin, packedGambeson] } } }) },
    abilities: ['sprinter-1', 'synesthesia-1', 'tackle'],
    spells: { sleep: { method: 'intuitive', practice: 1 }, darken: { method: 'intuitive', practice: 0 } },
    usedSurge: 'focus',
    pendingAction: { kind: 'spell', key: 'sleep', score: 12, SOP: 7, spent: {} },
    afflictions: ['prone'],
    injuries: { ...base.injuries, injuryLevel: 12, bleed: 2, potion: 3 },
    resources: { AP: 6, STA: 10, hunger: 3, thirst: 3, exhaustion: 3 },
  }
}

// The subject with nothing on and the AP to put something on.
const bareAndRested = (c: CampaignCharacter): CampaignCharacter => ({ ...c, worn: null, resources: { ...c.resources, AP: 12 } })

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
  wearFromContainer: (c) => characterCommands.wearFromContainer('belt', packedGambeson.id)(bareAndRested(c)),
  wearFromHands: (c) => {
    const suit = gambeson()
    return characterCommands.wearFromHands(suit.id)(itemCommands.holdItem(suit)(bareAndRested(c)))
  },
  equipArmor: (c) => characterCommands.equipArmor(gambeson())(bareAndRested(c)),
  doffArmor: characterCommands.doffArmor(null),
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
  castSpell: characterCommands.castSpell('darken', 7),
  applyModification: characterCommands.applyModification('extend'),
  clearPendingAction: characterCommands.clearPendingAction,
  suffocate: (c) => characterCommands.suffocate({ ...c, afflictions: ['suffocating'] }),
  applyTrigger: (c) => characterCommands.applyTrigger('end_round')(characterCommands.toggleAbility('synesthesia-1')(c) as CampaignCharacter),
  applyEffects: characterCommands.applyEffects([{ name: '', trigger: 'instant', type: 'cost', effect: { AP: 1, STA: 1, exhaustion: 0, IL: 0, ET: 0 } }]),
  expireUsedAbilities: (c) => characterCommands.expireUsedAbilities(characterCommands.useAbility('tackle')(c) as CampaignCharacter),
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

const NOT_UPDATERS = new Set<string>()

const newId = () => 'issued'

// The subject holds a strike committed by `a` at `b`, with `b`'s evade in
// answer, so every phase has something to act on; the commands that need the
// fight in another phase are run on a frozen state one command along.
const combatCases: Record<string, (s: CombatState) => unknown> = {
  nextRound: combatCommands.nextRound,
  resetCombat: combatCommands.resetCombat,
  startTurn: combatCommands.startTurn,
  declareAction: (s) => combatCommands.declareAction('a', { kind: 'strike' }, newId)(deepFreeze(cleared(s))),
  amendAction: (s) => combatCommands.amendAction({ location: 'head' })(deepFreeze(declaredStrike(s))),
  setTarget: (s) => combatCommands.setTarget('b')(deepFreeze(declaredStrike(s))),
  commitAction: (s) => combatCommands.commitAction()(deepFreeze(combatCommands.setTarget('b')(declaredStrike(s)))),
  amendReaction: combatCommands.amendReaction('b', { location: 'head' }),
  withdrawSpawnedAction: (s) => combatCommands.withdrawSpawnedAction(newId)(deepFreeze(spawnedFollow(s))),
  declareReaction: combatCommands.declareReaction('b', { kind: 'evasiveJump' }, newId),
  withdrawReaction: combatCommands.withdrawReaction('b'),
  withdrawLastReaction: combatCommands.withdrawLastReaction(),
  cancelAction: (s) => combatCommands.cancelAction()(deepFreeze(declaredStrike(s))),
  rollAction: combatCommands.rollAction(() => 7),
  spendHOP: (s) => combatCommands.spendHOP('smash')(deepFreeze(combatCommands.rollAction(() => 20)(s))),
  refundHOP: (s) => combatCommands.refundHOP('smash')(deepFreeze(combatCommands.spendHOP('smash')(combatCommands.rollAction(() => 20)(s)))),
  resolveAction: (s) => combatCommands.resolveAction()(deepFreeze(combatCommands.rollAction(() => 7)(s))),
  payAction: (s) => combatCommands.payAction()(deepFreeze(combatCommands.commitAction()(declaredMove(s)))),
  aimExplosion: (s) => combatCommands.aimExplosion(2)(deepFreeze(rolledExplosion(s))),
  createBoard: (s) => combatCommands.createBoard(4)(deepFreeze({ ...s, board: null })),
  importBoard: (s) => combatCommands.importBoard({ placements: { a: { cell: { q: 2, r: 2 } } } })(deepFreeze(cleared(s))),
  placeCharacter: (s) => combatCommands.placeCharacter('a', { q: 1, r: 1 })(deepFreeze(cleared(s))),
  turnCharacter: (s) => combatCommands.turnCharacter('a')(deepFreeze(cleared(s))),
  paintTerrain: (s) => combatCommands.paintTerrain({ q: 1, r: 1 }, 'wall')(deepFreeze(cleared(s))),
  pickCell: (s) => combatCommands.pickCell({ q: 1, r: 0 })(deepFreeze(declaredMove(s))),
  turnMove: (s) => combatCommands.turnMove()(deepFreeze(declaredMove(s))),
}

// The subject with its committed strike and the evade struck off, for the
// commands that need nothing open.
function cleared(s: CombatState): CombatState {
  return { ...s, actions: [] }
}

// The one-cell move committed, followed by `b` from the next cell, and paid
// for, which opens the follow as a move of `b`'s own, on a frozen state each
// step along.
function spawnedFollow(s: CombatState): CombatState {
  const committed = deepFreeze(combatCommands.commitAction()(deepFreeze(declaredMove(s))))
  const followed = deepFreeze(combatCommands.declareReaction('b', { kind: 'follow' }, newId)(committed))
  return combatCommands.payAction(newId)(followed)
}

// A grenade of `a`'s, thrown past the wall with nobody avoiding it and
// waiting to go off, on a frozen state a few commands along.
function rolledExplosion(s: CombatState): CombatState {
  const armed = deepFreeze({ ...cleared(s), characters: { ...s.characters, a: itemCommands.holdItem(grenadeItem)(s.characters.a) as CampaignCharacter } })
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'explosion', weaponKey: grenadeItem.id, attack: 'throw', variant: 'basic', center: { q: 0, r: 3 } }, newId)(armed))
  return combatCommands.payAction(newId)(deepFreeze(combatCommands.commitAction()(declared)))
}

// The committed strike cancelled and a fresh one declared in its place, on a
// frozen state a couple of commands along, for the commands that only run
// before the commit.
function declaredStrike(s: CombatState): CombatState {
  return combatCommands.declareAction('a', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)(deepFreeze(cleared(s)))
}

// The strike cancelled and a one-cell move declared in its place, on a
// frozen state a few commands along.
function declaredMove(s: CombatState): CombatState {
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'move' }, newId)(deepFreeze(cleared(s))))
  return combatCommands.amendAction({ movement: 'crawl', path: [{ q: 1, r: 0 }] })(declared)
}

function combatSubject(): CombatState {
  const a = { ...characterSubject(), id: 'a', fightName: 'a' }
  const b = { ...characterSubject(), id: 'b', fightName: 'b' }
  const strike = { kind: 'strike', id: 's1', actorId: 'a', targetId: 'b', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic', status: 'committed' }
  const evade = { kind: 'evade', id: 'r1', actorId: 'b', targetId: 'a', reactionTo: 's1' }
  return {
    ...CombatStateSchema.parse({
      actions: [strike, evade],
      board: { placements: { a: { cell: { q: 0, r: 0 } }, b: { cell: { q: 0, r: 1 } } }, terrain: { '2,0': { blocking: true } } },
    }),
    characters: { a, b },
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
