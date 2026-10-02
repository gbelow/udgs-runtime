import { describe, it, expect } from 'vitest'
import * as characterCommands from './character/commands'
import * as itemCommands from './item/commands'
import * as nextRoundModule from './combat/commands/nextRound'
import * as resetCombatModule from './combat/commands/resetCombat'
import * as turnModule from './combat/commands/turn'
import * as breakageModule from './combat/commands/breakage'
import * as actionsModule from './combat/commands/action'
import * as choicesModule from './combat/commands/choices'
import * as boardModule from './combat/commands/board'
import * as bindModule from './combat/commands/bind'
import * as floorModule from './combat/commands/floor'
import * as charactersModule from './combat/commands/characters'
import { CombatStateSchema, type CombatState } from './combat/types'
import { getOpenAction } from './combat/rules/log'
import { getRootTest } from './combat/rules/attack'
import { makeCampaignCharacter } from './factories'
import { produceEffects } from './character/rules/production'
import { SPELLS } from './spells'
import { severPart } from './character/commands/wounds'
import { ArmorSchema, ContainerSchema, DamageSchema, ItemSchema } from './types'
import type { CampaignCharacter, Character } from './types'
import armorsCatalog from '../assets/armors.json'

const combatCommands = { ...nextRoundModule, ...resetCombatModule, ...turnModule, ...breakageModule, ...actionsModule, ...choicesModule, ...boardModule, ...bindModule, ...floorModule, ...charactersModule }

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
const shieldItem = ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 3 })
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
    body: base.body.map((part) => (part.id === 'handL' ? { ...part, itemId: daggerItem.id } : part)),
    held: [daggerItem],
    containers: { belt: ContainerSchema.parse({ name: 'Belt', kind: 'belt', slots: { quick: { numSlots: 4, slotBulk: 2, items: [coin, packedGambeson] } } }) },
    abilities: ['sprinter-1', 'synesthesia-1', 'tackle'],
    spells: { sleep: { method: 'intuitive', practice: 1 }, darken: { method: 'intuitive', practice: 0 } },
    usedSurge: 'focus',
    afflictions: ['prone'],
    pending: [{ effect: { name: 'venom', trigger: 'instant', type: 'affliction', effect: { key: 'blind' } }, degree: null, test: { roll: 'health', DL: 5 }, when: null, then: [], locks: null }],
    injuries: { ...base.injuries, injuryLevel: 12, bleed: 2, potion: 3 },
    resources: { AP: 6, surgeAP: 2, STA: 10, hunger: 3, thirst: 3, exhaustion: 3 },
  }
}

// The subject holding a sustained spell.
const linking = (c: CampaignCharacter): CampaignCharacter => ({
  ...c,
  spells: { ...c.spells, 'telepathic-link': { method: 'intuitive', practice: 0 } },
  active: [...c.active, { kind: 'spell', key: 'telepathic-link' }],
})

// The subject with nothing on, off the clock: gear.tex "Donning and Doffing
// armor" allows no donning in a fight.
const bareOnSheet = (c: CampaignCharacter): Character => ({ ...c, type: 'base', worn: null }) as unknown as Character

// Keyed by the export name so the completeness check below can tell a command
// that has no purity case from one that is deliberately not an updater.
const characterCases: Record<string, (c: CampaignCharacter) => unknown> = {
  heal: characterCommands.heal(4),
  updateIL: characterCommands.updateIL(0),
  bleed: characterCommands.bleed(2),
  updateSTA: characterCommands.updateSTA(1),
  addAffliction: characterCommands.addAffliction('blind'),
  inflict: characterCommands.inflict(['prone']),
  cure: characterCommands.cure(['prone']),
  restCharacter: characterCommands.restCharacter,
  restWhileCasting: characterCommands.restWhileCasting({ AP: 1, STA: 0 }),
  actionSurge: characterCommands.actionSurge('focus'),
  endSurge: characterCommands.endSurge,
  wearFromContainer: (c) => characterCommands.wearFromContainer('belt', packedGambeson.id)(bareOnSheet(c)),
  wearFromHands: (c) => {
    const suit = gambeson()
    return characterCommands.wearFromHands(suit.id)(itemCommands.holdItem(suit)(bareOnSheet(c)))
  },
  equipArmor: (c) => characterCommands.equipArmor(gambeson())(bareOnSheet(c)),
  doffArmor: characterCommands.doffArmor(null),
  putGauntlets: characterCommands.putGauntlets,
  putHelm: characterCommands.putHelm,
  toggleVisor: (c) => characterCommands.toggleVisor({ ...c, hasHelm: 1 }),
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
  releaseSpell: characterCommands.releaseSpell('sleep'),
  loseConcentration: (c) => characterCommands.loseConcentration(linking(c)),
  suffocate: characterCommands.suffocate,
  applyTrigger: (c) => characterCommands.applyTrigger('end_round')(characterCommands.toggleAbility('synesthesia-1')(c) as CampaignCharacter),
  applyEffects: characterCommands.applyEffects([{ name: '', trigger: 'instant', type: 'cost', effect: { AP: 1, STA: 1, exhaustion: 0, IL: 0, ET: 0 } }]),
  resolvePending: characterCommands.resolvePending(0, () => 3),
  resistCurse: (c) => characterCommands.resistCurse('sleep', () => 20)({ ...c, active: [...c.active, { kind: 'curse', key: 'sleep', DL: 5 }] }),
  deliver: characterCommands.deliver({ effect: { name: '', trigger: 'instant', type: 'damage', effect: DamageSchema.parse({ damage: [{ kind: 'blunt', value: 30 }] }) }, degree: 'hit', test: null, when: null, then: [], locks: null }),
  deliverAll: characterCommands.deliverAll([{ effect: { name: '', trigger: 'instant', type: 'damage', effect: DamageSchema.parse({ damage: [{ kind: 'blunt', value: 30 }] }) }, degree: 'hit', test: null, when: null, then: [], locks: null }]),
  healWound: (c) => characterCommands.healWound(0, 3)({ ...c, injuries: { ...c.injuries, wounds: [{ key: 'brokenLeg', part: 'legL', IL: 20 }] } }),
  expireUsedAbilities: (c) => characterCommands.expireUsedAbilities(characterCommands.useAbility('tackle')(c) as CampaignCharacter),
}

const itemCases: Record<string, (c: CampaignCharacter) => unknown> = {
  duplicateItem: (c) => itemCommands.duplicateItem(c.containers.belt.slots.quick.items[0], { amount: 2 }),
  addItemToContainer: itemCommands.addItemToContainer('belt', 'quick', ItemSchema.parse({ name: 'Ration', bulk: 1 })),
  removeItemFromContainer: (c) => itemCommands.removeItemFromContainer('belt', c.containers.belt.slots.quick.items[0].id)(c),
  breakItem: itemCommands.breakItem(daggerItem.id),
  repairItem: itemCommands.repairItem(daggerItem.id),
  equipContainer: itemCommands.equipContainer('pack', ContainerSchema.parse({ name: 'Backpack', kind: 'backpack' })),
  putOnFromCatalog: itemCommands.putOnFromCatalog(ItemSchema.parse({ name: 'Sled', type: 'container', refId: 'Sled', bulk: 5, container: { name: 'Sled', kind: 'vehicle' } })),
  putOnFromHands: (c) => itemCommands.putOnFromHands('sled')(itemCommands.holdItem(ItemSchema.parse({ id: 'sled', name: 'Sled', type: 'container', refId: 'Sled', bulk: 2, container: { name: 'Sled', kind: 'vehicle' } }))(c)),
  putOnFromContainer: (c) => itemCommands.putOnFromContainer('belt', 'sled')(itemCommands.addItemToContainer('belt', 'quick', ItemSchema.parse({ id: 'sled', name: 'Sled', type: 'container', refId: 'Sled', bulk: 1, container: { name: 'Sled', kind: 'vehicle' } }))(c)),
  takeOffContainer: itemCommands.takeOffContainer('belt'),
  holdItem: itemCommands.holdItem(ItemSchema.parse({ name: 'Torch', bulk: 1 })),
  regripItem: itemCommands.regripItem(daggerItem.id, 2),
  drawItem: (c) => itemCommands.drawItem('belt', c.containers.belt.slots.quick.items[0].id)(c),
  storeItem: itemCommands.storeItem(daggerItem.id, 'belt', 'quick'),
  dropItem: itemCommands.dropItem(daggerItem.id),
  chargeItem: (c) => itemCommands.chargeItem('shock-explosive')(itemCommands.holdItem(ItemSchema.parse({ name: 'Grenade', type: 'weapon', refId: 'Grenade', bulk: 1 }))(c)),
  consumeItem: itemCommands.consumeItem(daggerItem.id),
  dischargeItem: itemCommands.dischargeItem(daggerItem.id),
  slingShield: (c) => itemCommands.slingShield(shieldItem.id)(itemCommands.holdItem(shieldItem)(c)),
  unslingShield: (c) => itemCommands.unslingShield()({ ...c, onBack: shieldItem }),
  throwOffShield: (c) => itemCommands.throwOffShield()({ ...c, onBack: shieldItem }),
}

const NOT_UPDATERS = new Set<string>()

const newId = () => 'issued'

// The subject holds a strike committed by `a` at `b`, with `b`'s evade in
// answer, so every phase has something to act on; the commands that need the
// fight in another phase are run on a frozen state one command along.
const combatCases: Record<string, (s: CombatState) => unknown> = {
  nextRound: combatCommands.nextRound(() => 0),
  resetCombat: combatCommands.resetCombat,
  startTurn: (s) => combatCommands.startTurn('b')(deepFreeze({ ...cleared(s), inTurnCharacter: '' })),
  toggleBreakage: (s) => combatCommands.toggleBreakage(deepFreeze(cleared(s))),
  endTurn: (s) => combatCommands.endTurn(deepFreeze(cleared(s))),
  toggleContest: (s) => combatCommands.toggleContest('b')(deepFreeze(cleared(s))),
  toggleAgreeToEnd: (s) => combatCommands.toggleAgreeToEnd('b')(deepFreeze(cleared(s))),
  rollContest: (s) => combatCommands.rollContest(() => 5)(deepFreeze(combatCommands.toggleContest('b')(deepFreeze(cleared(s))))),
  surge: (s) => combatCommands.surge('a', 'combat')(deepFreeze({ ...cleared(s), characters: { ...s.characters, a: { ...s.characters.a, usedSurge: null } } })),
  declareAction: (s) => combatCommands.declareAction('a', { kind: 'strike' }, newId)(deepFreeze(cleared(s))),
  amendAction: (s) => combatCommands.amendAction({ location: 'head' })(deepFreeze(declaredStrike(s))),
  setTarget: (s) => combatCommands.setTarget('b')(deepFreeze(declaredStrike(s))),
  commitAction: (s) => combatCommands.commitAction(() => 5, newId)(deepFreeze(combatCommands.setTarget('b')(declaredStrike(s)))),
  amendReaction: combatCommands.amendReaction('b', { location: 'head' }),
  withdrawSpawnedAction: (s) => combatCommands.withdrawSpawnedAction(newId)(deepFreeze(spawnedFollow(s))),
  declareReaction: combatCommands.declareReaction('b', { kind: 'evasiveJump' }, newId),
  withdrawReaction: combatCommands.withdrawReaction('b'),
  withdrawLastReaction: combatCommands.withdrawLastReaction(),
  cancelAction: (s) => combatCommands.cancelAction()(deepFreeze(declaredStrike(s))),
  rollAction: combatCommands.rollAction(() => 7, newId),
  spendHOP: (s) => combatCommands.spendHOP('smash')(deepFreeze(combatCommands.rollAction(() => 20, newId)(s))),
  refundHOP: (s) => combatCommands.refundHOP('smash')(deepFreeze(combatCommands.spendHOP('smash')(combatCommands.rollAction(() => 20, newId)(s)))),
  resolveAction: (s) => combatCommands.resolveAction(newId)(deepFreeze(combatCommands.rollAction(() => 7, newId)(s))),
  payAction: (s) => combatCommands.payAction(newId)(deepFreeze(combatCommands.commitAction(() => 5, newId)(declaredMove(s)))),
  acceptSpellTest: (s) => combatCommands.acceptSpellTest(newId)(deepFreeze(openSpellTest(s))),
  aimExplosion: (s) => combatCommands.aimExplosion(2)(deepFreeze(rolledExplosion(s))),
  improveSpell: (s) => combatCommands.improveSpell('enhance')(deepFreeze(rolledCast(s))),
  refundImprovement: (s) => combatCommands.refundImprovement('enhance')(deepFreeze(combatCommands.improveSpell('enhance')(deepFreeze(rolledCast(s))))),
  saveGraze: (s) => combatCommands.saveGraze()(deepFreeze(grazedCast(s))),
  moveWhileResting: (s) => combatCommands.moveWhileResting(newId)(deepFreeze(paidRest(s))),
  stepExtend: (s) => combatCommands.stepExtend(1)(deepFreeze(combatCommands.declareAction('a', { kind: 'cast', key: 'sleep' }, newId)(deepFreeze(cleared(s))))),
  chooseSpell: (s) => combatCommands.chooseSpell('sleep', true)(deepFreeze(combatCommands.declareAction('a', { kind: 'cast' }, newId)(deepFreeze(cleared(s))))),
  createBoard: (s) => combatCommands.createBoard(4)(deepFreeze({ ...s, board: null })),
  importBoard: (s) => combatCommands.importBoard({ placements: { a: { cell: { q: 2, r: 2 } } } })(deepFreeze(cleared(s))),
  placeCharacter: (s) => combatCommands.placeCharacter('a', { q: 1, r: 1 })(deepFreeze(cleared(s))),
  turnCharacter: (s) => combatCommands.turnCharacter('a')(deepFreeze(cleared(s))),
  paintTerrain: (s) => combatCommands.paintTerrain({ q: 1, r: 1 }, 'wall')(deepFreeze(cleared(s))),
  pickCell: (s) => combatCommands.pickCell({ q: 1, r: 0 }, newId)(deepFreeze(declaredMove(s))),
  turnMove: (s) => combatCommands.turnMove()(deepFreeze(declaredMove(s))),
  boostPush: (s) => combatCommands.boostPush(true)(deepFreeze(declaredPush(s))),
  chooseManeuver: (s) => combatCommands.chooseManeuver({ along: true })(deepFreeze(rolledManeuver(s))),
  settleBinds: (s) => combatCommands.settleBinds(deepFreeze(grappling(s))),
  settleSevered: (s) => combatCommands.settleSevered(s, 'x')(deepFreeze({ ...s, characters: { ...s.characters, a: severPart('handL')(s.characters.a) } })),
  dropToFloor: (s) => combatCommands.dropToFloor('a', daggerItem.id)(deepFreeze(grappling(s))),
  throwOffShieldToFloor: (s) => combatCommands.throwOffShieldToFloor('a')(deepFreeze({ ...cleared(s), characters: { ...s.characters, a: { ...s.characters.a, onBack: shieldItem } } })),
  pickFloorItem: (s) => combatCommands.pickFloorItem('a', daggerItem.id, newId)(deepFreeze({ ...cleared(s), floor: [{ item: daggerItem, cell: null }] })),
  pickThrowItem: (s) => combatCommands.pickThrowItem('a', daggerItem.id, newId)(deepFreeze({ ...cleared(s), floor: [{ item: daggerItem, cell: null }] })),
  removeFromCombat: (s) => combatCommands.removeFromCombat('b')(deepFreeze(grappling(s))),
  updateCharacter: (s) => combatCommands.updateCharacter('a', (c) => ({ ...c, held: [] }))(deepFreeze(grappling(s))),
}

// `a` and `b` holding each other, nothing open.
function grappling(s: CombatState): CombatState {
  return { ...cleared(s), binds: [{ kind: 'grapple', members: ['a', 'b'], holders: ['a', 'b'], immobile: [], anchors: {} }] }
}

// A knockdown by `a` on `b`, thrown, on a frozen state each step along.
function rolledManeuver(s: CombatState): CombatState {
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'grapple', maneuver: 'knockdown' }, newId)(deepFreeze(grappling(s))))
  const committed = deepFreeze(combatCommands.commitAction(() => 5, newId)(deepFreeze(combatCommands.setTarget('b')(declared))))
  return combatCommands.rollAction(() => 3, newId)(committed)
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
  const committed = deepFreeze(combatCommands.commitAction(() => 5, newId)(deepFreeze(declaredMove(s))))
  const followed = deepFreeze(combatCommands.declareReaction('b', { kind: 'follow' }, newId)(committed))
  return combatCommands.payAction(newId)(followed)
}

// A charged grenade of `a`'s, thrown past the wall, landed with nobody
// avoiding it and waiting to go off, on a frozen state a few commands along.
function rolledExplosion(s: CombatState): CombatState {
  const charged = { ...grenadeItem, charge: { key: 'shock-explosive', effects: produceEffects(s.characters.a, SPELLS['shock-explosive'].effects) } }
  const armed = deepFreeze({ ...cleared(s), characters: { ...s.characters, a: itemCommands.holdItem(charged)(s.characters.a) } })
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'throw', itemId: charged.id, to: { q: 0, r: 3 } }, newId)(armed))
  return combatCommands.payAction(newId)(deepFreeze(combatCommands.commitAction(() => 5, newId)(declared)))
}

// A cast of `a`'s sleep, rolled high enough to have HOP to spend, on a
// frozen state a few commands along.
function rolledCast(s: CombatState): CombatState {
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'cast', key: 'sleep' }, newId)(deepFreeze(cleared(s))))
  return combatCommands.commitAction(() => 30, newId)(declared)
}

// A's telepathic link at `b` cast and landed, leaving `b`'s test against it
// open, on a frozen state each step along.
function openSpellTest(s: CombatState): CombatState {
  const learned = { ...cleared(s), characters: { ...s.characters, a: { ...s.characters.a, spells: { ...s.characters.a.spells, 'telepathic-link': { method: 'intuitive' as const, practice: 0 } } } } }
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'cast', key: 'telepathic-link' }, newId)(deepFreeze(learned)))
  const committed = deepFreeze(combatCommands.commitAction(() => 5, newId)(deepFreeze(combatCommands.setTarget('b')(declared))))
  return combatCommands.resolveAction(newId)(deepFreeze(combatCommands.rollAction(() => 30, newId)(committed)))
}

// A's rest paid for, waiting to land, on a frozen state each step along.
function paidRest(s: CombatState): CombatState {
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'rest' }, newId)(deepFreeze(cleared(s))))
  return combatCommands.commitAction(() => 5, newId)(declared)
}

// A's cast of sleep rolled to a graze the graze save carries to a hit.
function grazedCast(s: CombatState): CombatState {
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'cast', key: 'sleep' }, newId)(deepFreeze(cleared(s))))
  const test = getRootTest(declared, getOpenAction(declared)!)!
  return combatCommands.commitAction(() => test.DL - test.skill + 3, newId)(declared)
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

// A push by `a`, grappling `b`, declared and aimed at them — `a` stood up,
// since the prone "cannot push nor drag".
function declaredPush(s: CombatState): CombatState {
  const grappled = grappling(s)
  const standing = { ...grappled, characters: { ...grappled.characters, a: { ...grappled.characters.a, afflictions: [] } } }
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'drag' }, newId)(deepFreeze(standing)))
  const aimed = combatCommands.setTarget('b')(declared)
  expect(getOpenAction(aimed)?.kind).toBe('drag')
  return aimed
}

function combatSubject(): CombatState {
  const a = { ...characterSubject(), id: 'a', fightName: 'a' }
  const b = { ...characterSubject(), id: 'b', fightName: 'b' }
  const strike = { kind: 'strike', id: 's1', actorId: 'a', targetId: 'b', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic', step: 'react' }
  const evade = { kind: 'evade', id: 'r1', actorId: 'b', targetId: 'a', reactionTo: 's1' }
  return {
    ...CombatStateSchema.parse({
      actions: [strike, evade],
      stack: ['s1'],
      board: { placements: { a: { cell: { q: 0, r: 0 } }, b: { cell: { q: 0, r: 1 } } }, terrain: { '2,0': { blocking: true } } },
    }),
    characters: { a, b },
    activeCharacterId: 'a',
    inTurnCharacter: 'a',
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
