import { describe, it, expect } from 'vitest'
import * as characterCommands from './character/commands'
import * as itemCommands from './item/commands'
import * as creationCommands from './character/commands/creation'
import * as nextRoundModule from './scene/commands/nextRound'
import * as resetCombatModule from './scene/commands/resetCombat'
import * as turnModule from './scene/commands/turn'
import * as actionsModule from './scene/commands/action'
import * as choicesModule from './scene/commands/choices'
import * as boardModule from './scene/commands/board'
import * as bindModule from './scene/commands/bind'
import * as floorModule from './scene/commands/floor'
import * as charactersModule from './scene/commands/characters'
import * as fightPartiesModule from './scene/commands/parties'
import * as gmExplosionModule from './scene/commands/gmExplosion'
import { EXPLOSION_DRAFT } from './scene/rules/impose'
import * as moraleModule from './scene/commands/morale'
import * as socialModule from './scene/commands/social'
import * as answerModule from './scene/commands/answer'
import * as rosterModule from './campaign/commands/roster'
import * as fightModule from './scene/commands/fight'
import * as clockModule from './campaign/commands/clock'
import * as partiesModule from './campaign/commands/parties'
import * as collectionsModule from './campaign/commands/collections'
import * as journalModule from './campaign/commands/journal'
import * as namesModule from './campaign/commands/names'
import * as scenesModule from './campaign/commands/scenes'
import * as episodeModule from './scene/commands/episode'
import * as mapModule from './campaign/commands/map'
import * as eventModule from './campaign/commands/event'
import { CampaignStateSchema, CollectionSchema, CrawlEventSchema, CrawlMapSchema, type CampaignState, type Collection, type CrawlEvent, type CrawlMap } from './campaign/types'
import type { Table } from './scene/types'
import * as explorationModule from './exploration/commands/exploration'
import * as plansModule from './exploration/commands/plans'
import { ExplorationStateSchema, MeetingSchema, type Exploring } from './exploration/types'
import * as downtimeModule from './downtime/commands/downtime'
import * as downtimePlansModule from './downtime/commands/plans'
import { DowntimeStateSchema, type Downtime } from './downtime/types'
import { SceneStateSchema, SocialActionSchema, type SceneState } from './scene/types'
import { getOpenAction, withLiveActions } from './scene/rules/log'
import { getRootTest } from './scene/rules/attack'
import { makeCampaignCharacter, makeCreationDraft } from './factories'
import { produceEffects } from './character/rules/production'
import { SPELLS } from './spells'
import { severPart } from './character/commands/wounds'
import { ArmorSchema, ContainerSchema, DamageSchema, ItemSchema, RaceDraftSchema, RaceSchema, TrainableSchema } from './types'
import type { CampaignCharacter, Character, CreationDraft } from './types'
import armorsCatalog from '../assets/armors.json'

// A character holding a race being made, for the commands that make one.
const drafting = (c: CampaignCharacter): CampaignCharacter => ({ ...c, raceDraft: RaceDraftSchema.parse({}) })

const combatCommands = { ...nextRoundModule, ...resetCombatModule, ...turnModule, ...actionsModule, ...choicesModule, ...boardModule, ...bindModule, ...floorModule, ...charactersModule, ...fightPartiesModule, ...gmExplosionModule, ...moraleModule, ...socialModule, ...answerModule }
const campaignCommands = { ...rosterModule, ...fightModule, ...clockModule, ...partiesModule, ...journalModule, ...namesModule, ...scenesModule, ...episodeModule }
const explorationCommands = { ...explorationModule, ...plansModule }
const downtimeCommands = { ...downtimeModule, ...downtimePlansModule }

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

// An ability family held at a level, with XP toward the next.
const held = (name: string, value: number, XP = 0) => TrainableSchema.parse({ name, type: 'ability', value, XP })

function characterSubject(): CampaignCharacter {
  const base = makeCampaignCharacter({})
  const withKnowledge = characterCommands.addSpecificKnowledge('the old town')(base) as CampaignCharacter
  return {
    ...withKnowledge,
    armor,
    worn: gambeson(),
    body: base.body.map((part) => (part.id === 'handL' ? { ...part, itemId: daggerItem.id } : part)),
    held: [daggerItem],
    containers: { belt: ContainerSchema.parse({ name: 'Belt', kind: 'belt', slots: { quick: { numSlots: 4, slotBulk: 2, items: [coin, packedGambeson] } } }) },
    abilities: { sprinter: held('sprinter', 1), synesthesia: held('synesthesia', 1), tackle: held('tackle', 1), jumper: held('jumper', 0, 2) },
    spells: { sleep: { method: 'intuitive', practice: 1 }, darken: { method: 'intuitive', practice: 0 } },
    usedSurge: 'focus',
    afflictions: ['prone'],
    pending: [{ effect: { name: 'venom', trigger: 'instant', type: 'affliction', effect: { key: 'blind', cure: false } }, degree: null, test: { roll: 'health', DL: 5 }, when: null, then: [], locks: null }],
    injuries: { ...base.injuries, injuryLevel: 12, bleed: 2, potion: 3 },
    surgeFloor: 6,
    resources: { AP: 8, STA: 10, hunger: 3, thirst: 3, exhaustion: 3 },
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
  leaveFight: characterCommands.leaveFight,
  updateSTA: characterCommands.updateSTA(1),
  addAffliction: characterCommands.addAffliction('blind'),
  inflict: characterCommands.inflict(['prone']),
  cure: characterCommands.cure(['prone']),
  restCharacter: characterCommands.restCharacter,
  restWhileCasting: characterCommands.restWhileCasting({ AP: 1, STA: 0 }, true),
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
  addSpecificKnowledge: characterCommands.addSpecificKnowledge('the river'),
  setLimitStress: characterCommands.setLimitStress('coward'),
  removeSpecificKnowledge: characterCommands.removeSpecificKnowledge('the old town'),
  addTrainingXP: characterCommands.addTrainingXP('strike', 4),
  addAbilityXP: characterCommands.addAbilityXP('jumper', 4),
  raiseSpecificKnowledge: characterCommands.raiseSpecificKnowledge('the old town', 3),
  grantAbility: characterCommands.grantAbility('keen-eyes-2'),
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
  healWound: (c) => characterCommands.healWound(0, 3)({ ...c, injuries: { ...c.injuries, wounds: [{ name: 'broken leg', part: 'legL', IL: 20, perDay: 0 }] } }),
  setWound: (c) => characterCommands.setWound(0, 2)({ ...c, injuries: { ...c.injuries, wounds: [{ name: 'broken leg', part: 'legL', IL: 20, perDay: 0 }] } }),
  takeDose: (c) => characterCommands.takeDose('vial')(itemCommands.holdItem(ItemSchema.parse({ id: 'vial', name: 'Darkseeing', type: 'medicine' }))(c)),
  wearOff: (c) => characterCommands.wearOff(1)({ ...c, active: [{ kind: 'potion', key: 'Darkseeing', ETs: 2 }] }),
  expireUsedAbilities: (c) => characterCommands.expireUsedAbilities(characterCommands.useAbility('tackle')(c) as CampaignCharacter),
  applyRace: (c) => characterCommands.applyRace(RaceSchema.parse({ name: 'Surbit', size: 2, bonuses: { AGI: 2 }, abilities: ['fur'] }))(c),
  editRace: (c) => characterCommands.editRace({ bonuses: { STR: 1 } })(drafting(c)),
  addRaceAbility: (c) => characterCommands.addRaceAbility('fur')(drafting(c)),
  removeRaceAbility: (c) => characterCommands.removeRaceAbility('fur')(characterCommands.addRaceAbility('fur')(drafting(c))),
  addBodyPart: (c) => characterCommands.addBodyPart('other')(c),
  removeBodyPart: (c) => characterCommands.removeBodyPart('legL')(c),
  editBodyPart: (c) => characterCommands.editBodyPart('handL', { grip: false, flags: ['stunUnconscious'] })(c),
  addPartWound: (c) => characterCommands.addPartWound('head')(c),
  editPartWound: (c) => characterCommands.editPartWound('handL', 0, { tier: 3 })(c),
  removePartWound: (c) => characterCommands.removePartWound('handL', 0)(c),
  editStance: (c) => characterCommands.editStance({ lameAt: 2 })(c),
  editNaturalArmor: (c) => characterCommands.editNaturalArmor({ INS: 2 })(c),
  toggleFootprintCell: (c) => characterCommands.toggleFootprintCell({ q: 1, r: 0 })(c),
  setFootprintPreset: (c) => characterCommands.setFootprintPreset('line')(c),
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
  spendDoses: (c) => itemCommands.spendDoses('roll', 3)(itemCommands.holdItem(ItemSchema.parse({ id: 'roll', name: 'Bandages', type: 'medicine' }))(c)),
  dischargeItem: itemCommands.dischargeItem(daggerItem.id),
  slingShield: (c) => itemCommands.slingShield(shieldItem.id)(itemCommands.holdItem(shieldItem)(c)),
  unslingShield: (c) => itemCommands.unslingShield()({ ...c, onBack: shieldItem }),
  throwOffShield: (c) => itemCommands.throwOffShield()({ ...c, onBack: shieldItem }),
  trade: (c) => itemCommands.trade({ offered: [c.containers.belt.slots.quick.items[0].id], cart: [] })(c),
  pay: itemCommands.pay(1),
  receive: itemCommands.receive(12),
  settleStartingWealth: (c) => itemCommands.settleStartingWealth({ ...c, type: 'base', startingWealth: 500 } as unknown as Character),
}

// A character being made, with a race, a stage and a level bought.
function creationSubject(): CreationDraft {
  const raced = creationCommands.setCreationRace(RaceSchema.parse({ name: 'Furred', bonuses: { STR: 1, DEX: 1 }, abilities: ['fur'] }))(makeCreationDraft())
  return { ...raced, trainables: { strike: 2, STR: 1 }, abilities: { sprinter: 1 } }
}

const creationCases: Record<string, (d: CreationDraft) => unknown> = {
  setCreationRace: creationCommands.setCreationRace(null),
  setCreationName: creationCommands.setCreationName('Ann'),
  setCreationPriority: creationCommands.setCreationPriority('DEX', 'A'),
  setCreationNotes: creationCommands.setCreationNotes('a scar'),
  setCreationLimitStress: creationCommands.setCreationLimitStress('coward'),
  setCreationConviction: creationCommands.setCreationConviction('conviction1', 'Fatalism'),
  buyCreationLevel: creationCommands.buyCreationLevel('strike', 1),
  setCreationProgress: creationCommands.setCreationProgress('strike', 1),
  buyCreationStage: creationCommands.buyCreationStage('sprinter', -1),
  setCreationSpell: creationCommands.setCreationSpell('detonate-explosive', 'intuitive'),
  claimCreationSpell: creationCommands.claimCreationSpell('detonate-explosive'),
  updateCreationCharacter: creationCommands.updateCreationCharacter((c) => itemCommands.holdItem(ItemSchema.parse({ name: 'Torch', bulk: 1 }))(c)),
  getFinishedCharacter: creationCommands.getFinishedCharacter,
}

const NOT_UPDATERS = new Set<string>(['newCollection', 'readPick'])

const newId = () => 'issued'

// The subject holds a strike committed by `a` at `b`, with `b`'s evade in
// answer, so every phase has something to act on; the commands that need the
// fight in another phase are run on a frozen state one command along.
const combatCases: Record<string, (s: SceneState) => unknown> = {
  nextRound: combatCommands.nextRound(() => 0),
  answerScene: (s) => combatCommands.answerScene('contest:a', 4, 'entered', () => 0, newId)({ ...s, resume: { kind: 'contest' }, calls: { 'contest:a': { id: 'contest:a', roller: 'a', label: 'cunning, for the turn', explodes: false, mode: 'normal', test: null, die: null, source: 'screen' } } }),
  continueRound: (s) => combatCommands.continueRound(() => 0)(deepFreeze({ ...cleared(s), inTurnCharacter: '', roundStep: 'rest' })),
  holdOn: (s) => combatCommands.holdOn('a', () => 0)(deepFreeze({ ...cleared(s), inTurnCharacter: '', roundStep: 'concentration' })),
  letGo: (s) => combatCommands.letGo('a', () => 0)(deepFreeze({ ...cleared(s), inTurnCharacter: '', roundStep: 'concentration' })),
  rollMorale: (s) => combatCommands.rollMorale('a', 'safe', true, () => 3)(deepFreeze({ ...s, morale: [{ id: 'a', roll: null }] })),
  setTablePressure: (s) => combatCommands.setTablePressure('a', 2)(deepFreeze(s)),
  landSocial: (s) => combatCommands.landSocial(deepFreeze(cleared(s)), SocialActionSchema.parse({ id: 'x', actorId: 'a', kind: 'social', say: 'rally' })),
  defaultToCoward: (s) => combatCommands.defaultToCoward('a')(deepFreeze({ ...cleared(s), inTurnCharacter: 'a', compulsions: [{ id: 'a', action: 'abusive', acted: false, taken: false, by: '', constraint: null }] })),
  resetCombat: combatCommands.resetCombat,
  startTurn: (s) => combatCommands.startTurn('b')(deepFreeze({ ...cleared(s), inTurnCharacter: '' })),
  endTurn: (s) => combatCommands.endTurn(deepFreeze(cleared(s))),
  toggleContest: (s) => combatCommands.toggleContest('b')(deepFreeze(cleared(s))),
  toggleAgreeToEnd: (s) => combatCommands.toggleAgreeToEnd('b')(deepFreeze(cleared(s))),
  agreeAllToEnd: (s) => combatCommands.agreeAllToEnd(['a', 'b'])(deepFreeze(cleared(s))),
  rollContest: (s) => combatCommands.rollContest(() => 5)(deepFreeze(combatCommands.toggleContest('b')(deepFreeze(cleared(s))))),
  surge: (s) => combatCommands.surge('a', 'combat')(deepFreeze({ ...cleared(s), characters: { ...s.characters, a: { ...s.characters.a, usedSurge: null } } })),
  declareAction: (s) => combatCommands.declareAction('a', { kind: 'strike' }, newId)(deepFreeze(cleared(s))),
  amendAction: (s) => combatCommands.amendAction({ location: 'head' })(deepFreeze(declaredStrike(s))),
  setTarget: (s) => combatCommands.setTarget('b')(deepFreeze(declaredStrike(s))),
  aimAtCell: (s) => combatCommands.aimAtCell({ q: 1, r: 0 })(deepFreeze(declaredStrike(s))),
  commitAction: (s) => combatCommands.commitAction(() => 5, newId)(deepFreeze(combatCommands.setTarget('b')(declaredStrike(s)))),
  amendReaction: combatCommands.amendReaction('b', { location: 'head' }),
  withdrawSpawnedAction: (s) => combatCommands.withdrawSpawnedAction(() => 5, newId)(deepFreeze(spawnedFollow(s))),
  declareReaction: combatCommands.declareReaction('b', { kind: 'evasiveJump' }, newId),
  withdrawReaction: combatCommands.withdrawReaction('b'),
  withdrawLastReaction: combatCommands.withdrawLastReaction(),
  passReaction: combatCommands.passReaction('b'),
  rollAnswered: combatCommands.rollAnswered(() => 7, newId),
  cancelAction: (s) => combatCommands.cancelAction()(deepFreeze(declaredStrike(s))),
  rollAction: combatCommands.rollAction(() => 7, newId),
  spendHOP: (s) => combatCommands.spendHOP('smash')(deepFreeze(combatCommands.rollAction(() => 20, newId)(s))),
  refundHOP: (s) => combatCommands.refundHOP('smash')(deepFreeze(combatCommands.spendHOP('smash')(combatCommands.rollAction(() => 20, newId)(s)))),
  chooseGrapple: (s) => combatCommands.chooseGrapple(true)(deepFreeze(combatCommands.rollAction(() => 20, newId)(s))),
  resolveAction: (s) => combatCommands.resolveAction(newId, () => 5)(deepFreeze(combatCommands.rollAction(() => 7, newId)(s))),
  payAction: (s) => combatCommands.payAction(newId, () => 5)(deepFreeze(combatCommands.commitAction(() => 5, newId)(declaredMove(s)))),
  payAnswered: (s) => combatCommands.payAnswered(newId, () => 5)(deepFreeze(combatCommands.commitAction(() => 5, newId)(declaredMove(s)))),
  acceptAnswered: (s) => combatCommands.acceptAnswered(newId, () => 5)(deepFreeze(openSpellTest(s))),
  rollOrPay: (s) => combatCommands.rollOrPay(() => 5, newId)(deepFreeze(combatCommands.commitAction(() => 5, newId)(declaredMove(s)))),
  acceptSpellTest: (s) => combatCommands.acceptSpellTest(newId, () => 5)(deepFreeze(openSpellTest(s))),
  aimExplosion: (s) => combatCommands.aimExplosion(2)(deepFreeze(rolledExplosion(s))),
  displaceTrampled: (s) => combatCommands.displaceTrampled({ q: 1, r: 1 })(deepFreeze(crashedMove(s))),
  improveSpell: (s) => combatCommands.improveSpell('enhance')(deepFreeze(rolledCast(s))),
  refundImprovement: (s) => combatCommands.refundImprovement('enhance')(deepFreeze(combatCommands.improveSpell('enhance')(deepFreeze(rolledCast(s))))),
  saveGraze: (s) => combatCommands.saveGraze()(deepFreeze(grazedCast(s))),
  moveWhileResting: (s) => combatCommands.moveWhileResting(newId)(deepFreeze(paidRest(s))),
  stepExtend: (s) => combatCommands.stepExtend(1)(deepFreeze(combatCommands.declareAction('a', { kind: 'cast', key: 'sleep' }, newId)(deepFreeze(cleared(s))))),
  chooseSpell: (s) => combatCommands.chooseSpell('sleep', true)(deepFreeze(combatCommands.declareAction('a', { kind: 'cast' }, newId)(deepFreeze(cleared(s))))),
  createBoard: (s) => combatCommands.createBoard(4)(deepFreeze({ ...s, board: null })),
  removeBoard: (s) => combatCommands.removeBoard(deepFreeze(cleared(s))),
  resizeBoard: (s) => combatCommands.resizeBoard(1)(deepFreeze(cleared(s))),
  loadBoardMap: (s) => combatCommands.loadBoardMap({ name: 'x', terrain: { '1,1': { blocking: true } } })(deepFreeze(cleared(s))),
  placeCharacter: (s) => combatCommands.placeCharacter('a', { q: 1, r: 1 })(deepFreeze(cleared(s))),
  repositionCharacter: (s) => combatCommands.repositionCharacter('a', { q: 1, r: 1 })(deepFreeze(cleared(s))),
  turnCharacter: (s) => combatCommands.turnCharacter('a')(deepFreeze(cleared(s))),
  paintTerrain: (s) => combatCommands.paintTerrain({ q: 1, r: 1 }, 'wall')(deepFreeze(cleared(s))),
  setLight: (s) => combatCommands.setLight('dark')(deepFreeze(cleared(s))),
  pickCell: (s) => combatCommands.pickCell({ q: 1, r: 0 }, newId)(deepFreeze(declaredMove(s))),
  turnMove: (s) => combatCommands.turnMove()(deepFreeze(declaredMove(s))),
  backSegment: (s) => combatCommands.backSegment()(deepFreeze(combatCommands.pickCell({ q: 1, r: 0 }, newId)(declaredMove(s)))),
  boostPush: (s) => combatCommands.boostPush(true)(deepFreeze(declaredPush(s))),
  chooseManeuver: (s) => combatCommands.chooseManeuver({ along: true })(deepFreeze(rolledManeuver(s))),
  settleBinds: (s) => combatCommands.settleBinds(deepFreeze(grappling(s))),
  settleSevered: (s) => combatCommands.settleSevered(s, 'x')(deepFreeze({ ...s, characters: { ...s.characters, a: severPart('handL')(s.characters.a) } })),
  dropToFloor: (s) => combatCommands.dropToFloor('a', daggerItem.id)(deepFreeze(grappling(s))),
  throwOffShieldToFloor: (s) => combatCommands.throwOffShieldToFloor('a')(deepFreeze({ ...cleared(s), characters: { ...s.characters, a: { ...s.characters.a, onBack: shieldItem } } })),
  placeItem: (s) => combatCommands.placeItem(daggerItem, { q: 0, r: 0 }, newId)(deepFreeze(cleared(s))),
  removeFloorItem: (s) => combatCommands.removeFloorItem(daggerItem.id)(deepFreeze({ ...cleared(s), floor: [{ item: daggerItem, cell: null }] })),
  setOffExplosion: (s) => combatCommands.setOffExplosion({ ...EXPLOSION_DRAFT, radius: 2 }, { q: 0, r: 0 }, newId)(deepFreeze(cleared(s))),
  pickFloorItem: (s) => combatCommands.pickFloorItem('a', daggerItem.id, newId)(deepFreeze({ ...cleared(s), floor: [{ item: daggerItem, cell: null }] })),
  pickThrowItem: (s) => combatCommands.pickThrowItem('a', daggerItem.id, newId)(deepFreeze({ ...cleared(s), floor: [{ item: daggerItem, cell: null }] })),
  removeFromCombat: (s) => combatCommands.removeFromCombat('b')(deepFreeze(grappling(s))),
  impose: (s) => combatCommands.impose(['a', 'b'], { effect: { name: 'fall', trigger: 'instant', type: 'fall', effect: { height: 6 } }, degree: null, test: { roll: 'balance', DL: 6, direct: true }, when: null, then: [], locks: null })(deepFreeze(cleared(s))),
  updateCharacter: (s) => combatCommands.updateCharacter('a', (c) => ({ ...c, held: [] }))(deepFreeze(grappling(s))),
  updateInventory: (s) => combatCommands.updateInventory('a', (c) => ({ ...c, held: [] }))(deepFreeze(grappling(s))),
  dropEmptyFightParties: (s) => combatCommands.dropEmptyFightParties(deepFreeze({ ...partied(s), partyOf: { a: 'x', b: 'x' } }), ['y']),
  createParty: (s) => combatCommands.createParty('z', 'Z')(deepFreeze(partied(s))),
  joinFight: (s) => combatCommands.joinFight(makeCampaignCharacter({ name: 'c' }), 'x', 'X', [])(s),
  addToFight: (s) => combatCommands.addToFight(makeCampaignCharacter({ name: 'c' }), newId, [], [])(deepFreeze(partied(s))),
  moveToParty: (s) => combatCommands.moveToParty('a', 'y')(deepFreeze(partied(s))),
  splitOff: (s) => combatCommands.splitOff('a', newId)(deepFreeze(partied(s))),
  renameParty: (s) => combatCommands.renameParty('x', 'Z')(deepFreeze(partied(s))),
  deleteParty: (s) => combatCommands.deleteParty('z')(deepFreeze(combatCommands.createParty('z', 'Z')(partied(s)))),
}

// The fight with `a` in party `x` and `b` in party `y`.
const partied = (s: SceneState): SceneState => ({ ...cleared(s), parties: { x: { name: 'X' }, y: { name: 'Y' } }, partyOf: { a: 'x', b: 'y' } })

// The table with `a` sent from the roster to the fight, in party `p`.
const away = ({ campaign, fight }: Table): Table => {
  const { a: _sent, ...characters } = campaign.characters
  return { campaign: { ...campaign, characters }, fight: { ...fight, parties: { p: { name: 'Party 1' } }, partyOf: { a: 'p' } } }
}

// The campaign's subject is a table: `a` and `b` on the roster in party
// `p` on node `n1`, `a` with an exhaustion Will test to make, and the combat
// subject's fight beside it, its strike cleared.
const campaignCases: Record<string, (t: Table) => unknown> = {
  addToRoster: ({ campaign }) => campaignCommands.addToRoster(characterSubject(), () => 'issued')(campaign),
  lend: ({ campaign }) => campaignCommands.lend('c')(campaign),
  release: ({ campaign }) => campaignCommands.release('a')(campaign),
  removeFromRoster: ({ campaign }) => campaignCommands.removeFromRoster('a')(campaign),
  updateRosterCharacter: ({ campaign }) => campaignCommands.updateRosterCharacter('a', (c) => ({ ...c, held: [] }))(campaign),
  checkOut: ({ campaign }) => campaignCommands.checkOut('a')(campaign),
  addParty: ({ campaign }) => campaignCommands.addParty('q')(campaign),
  dropEmptyParties: ({ campaign }) => campaignCommands.dropEmptyParties({ ...campaign, partyOf: {} }),
  joinParty: ({ campaign }) => campaignCommands.joinParty('c', () => 'q')(campaign),
  withParty: ({ campaign }) => campaignCommands.withParty('p', (p) => ({ ...p, name: 'x' }))(campaign),
  mergeParties: ({ campaign }) => campaignCommands.mergeParties('p', 'q')(campaignCommands.addParty('q')(campaign)),
  setPartyExposure: ({ campaign }) => campaignCommands.setPartyExposure('p', 3)(campaign),
  setPartyLit: ({ campaign }) => campaignCommands.setPartyLit('p', true)(campaign),
  setPartyPlace: ({ campaign }) => campaignCommands.setPartyPlace('p', { map: 'm', node: 'n2' })(campaign),
  addMap: ({ campaign }) => campaignCommands.addMap('other', { name: 'other' })(campaign),
  removeMap: ({ campaign }) => campaignCommands.removeMap('m')(campaign),
  updateCampaignMap: ({ campaign }) => campaignCommands.updateCampaignMap('m', mapModule.addNode(() => 'n9'))(campaign),
  record: ({ campaign }) => campaignCommands.record({ kind: 'et', party: 'p', title: 'an ET' })(campaign),
  writeNote: ({ campaign }) => campaignCommands.writeNote('p', 'a note', true, 'me')(campaign),
  editNote: ({ campaign }) => campaignCommands.editNote('1', 'another note', false)(campaignCommands.writeNote('p', 'a note', true, 'me')(campaign)),
  removeEntry: ({ campaign }) => campaignCommands.removeEntry('1')(campaign),
  setDayETs: ({ campaign }) => campaignCommands.setDayETs(2)(campaign),
  passETs: ({ campaign }) => campaignCommands.passETs(12, ['p'])(campaign),
  startTimeline: ({ campaign }) => campaignCommands.startTimeline('p')(campaign),
  placeOnTimeline: ({ campaign }) => campaignCommands.placeOnTimeline('p', 130)(campaign),
  passTimeTo: ({ campaign }) => campaignCommands.passTimeTo('p', 130)(campaign),
  setPartyActive: ({ campaign }) => campaignCommands.setPartyActive('p', false)(campaign),
  setPartySequence: ({ campaign }) => campaignCommands.setPartySequence('p', 'downtime')(campaign),
  createParty: ({ campaign }) => campaignCommands.createParty('q', 'Q')(campaign),
  renameParty: ({ campaign }) => campaignCommands.renameParty('p', 'P')(campaign),
  moveToParty: ({ campaign }) => campaignCommands.moveToParty('a', 'q')(campaignCommands.createParty('q', 'Q')(campaign)),
  splitOff: ({ campaign }) => campaignCommands.splitOff('a', () => 'q')(campaign),
  leaveParty: ({ campaign }) => campaignCommands.leaveParty('a')(campaign),
  nameByParty: ({ campaign }) => campaignCommands.nameByParty(['a'])(campaign),
  sendToFight: (t) => campaignCommands.sendToFight(['a'])(t),
  returnFromFight: (t) => campaignCommands.returnFromFight(['a'], 0)(t),
  returnPartyFromFight: (t) => campaignCommands.returnPartyFromFight('p', 0)(t),
  sendPartyToFight: (t) => campaignCommands.sendPartyToFight('p')(t),
  saveFightLog: (t) => campaignCommands.saveFightLog(t),
  checkIn: ({ campaign }) => campaignCommands.checkIn(characterSubject(), { partyId: 'q', name: 'Q' }, 'c')(campaign),
  loadIntoFight: (t) => campaignCommands.loadIntoFight(characterSubject(), () => 'issued')(t),
  removeFromFight: (t) => campaignCommands.removeFromFight('a')(deepFreeze(away(t))),
  resetFight: (t) => campaignCommands.resetFight(deepFreeze(away(t))),
  toggleBreakage: (t) => campaignCommands.toggleBreakage(deepFreeze(away(t))),
  passBy: ({ campaign }) => campaignCommands.passBy('s')({ ...campaign, scenes: { s: { preset: 'x', party: 'p', members: ['a'], forced: false, event: 'E', at: null } } }),
  playScene: (t) => campaignCommands.playScene('s', null, {}, () => 'issued')(deepFreeze({ campaign: { ...t.campaign, lent: [], scenes: { s: { preset: 'x', party: 'p', members: ['a'], forced: true, event: 'E', at: { map: 'm', node: 'n1' } } } }, fight: resetCombatModule.resetCombat(t.fight) })),
  leaveBehind: ({ campaign, fight }) => campaignCommands.leaveBehind({ ...fight, foundAt: 'm/n1', floor: [{ item: ItemSchema.parse({ id: 'i' }), cell: null }] }, campaign),
}

// Exploration's subject is the campaign's beside what exploration keeps:
// `b` travelling along path `c` as group `g` of party `p`, with a camp.
const explorationCases: Record<string, (t: Exploring) => unknown> = {
  addGroup: (t) => explorationCommands.addGroup('p', 'fire', () => 'h')(t),
  removeGroup: (t) => explorationCommands.removeGroup('p', 'g')(t),
  setGroup: (t) => explorationCommands.setGroup('p', 'g', { DL: 5 })(t),
  setRoller: (t) => explorationCommands.setRoller('p', 'g', 'b')(t),
  joinGroup: (t) => explorationCommands.joinGroup('a', 'g')(t),
  setResting: (t) => explorationCommands.setResting('a', true)(t),
  planCast: (t) => explorationCommands.planCast('a', 'regenerate')(t),
  setCast: (t) => explorationCommands.setCast('a', { targets: ['b'], enhance: 1 })({ ...t, exploration: { ...t.exploration, casts: { a: { key: 'regenerate', targets: [], wound: null, item: '', DL: 0, enhance: 0, effortless: false } } } }),
  decide: (t) => explorationCommands.decide('b', 'carry')({ ...t, exploration: { ...t.exploration, opening: { rolls: { b: { die: 0, score: 0, DL: 5, degree: 'miss' } }, decisions: {}, start: {} } } }),
  eat: ({ campaign }) => explorationCommands.eat('a', 3)(campaign),
  eatFood: ({ campaign }) => explorationCommands.eatFood('a', 'ration')({ ...campaign, characters: { ...campaign.characters, a: { ...campaign.characters.a, held: [...campaign.characters.a.held, ItemSchema.parse({ id: 'ration', name: 'Ration', type: 'food', food: 3, amount: 2 })] } } }),
  drink: ({ campaign }) => explorationCommands.drink('a')(campaign),
  takeItem: ({ campaign }) => explorationCommands.takeItem('a', 'vial')({ ...campaign, characters: { ...campaign.characters, a: { ...campaign.characters.a, held: [...campaign.characters.a.held, ItemSchema.parse({ id: 'vial', name: 'Simple Healing', type: 'medicine', amount: 2 })] } } }),
  passET: (t) => explorationCommands.passET(() => 0, () => 'q')({ ...t, exploration: { ...t.exploration, resting: ['a'] } }),
  answerET: (t) => explorationCommands.answerET('group:p:g', 4, 'entered', () => 0, () => 'q')({ ...t, exploration: { ...t.exploration, calls: { 'group:p:g': { id: 'group:p:g', roller: 'b', label: 'travel', explodes: false, test: { skill: 0, DL: 5, scale: 'degrees', grazes: false }, mode: 'normal', die: null, source: 'screen' } } } }),
  toDowntime: (t) => explorationCommands.toDowntime('p')(t),
  adjustMet: (t) => explorationCommands.adjustMet(0, -3)({ ...t, exploration: { ...t.exploration, pending: { party: 'p', group: 'g', meeting: MeetingSchema.parse({ roll: null, events: [{ owner: { kind: 'connection', id: 'c' }, event: 'e', name: 'climb', DL: 5, degree: 'hit', outcome: { test: {} } }] }) } } }),
  resolvePlan: (t) => explorationCommands.resolvePlan('p', 'g', () => 0, () => 'q')(t),
  campIn: (t) => explorationCommands.campIn('p', null)(t),
  toggleWeatherTag: (t) => explorationCommands.toggleWeatherTag('p', 'rain')(t),
  setWeatherRaise: (t) => explorationCommands.setWeatherRaise('p', 2)(t),
  setOffAmbient: (t) => explorationCommands.setOffAmbient('p', 'e')(t),
  readItem: (t) => explorationCommands.readItem('a', 'i', () => 5)(t),
  clearWeather: (t) => explorationCommands.clearWeather('p')({ ...t, exploration: { ...t.exploration, weather: { 'm/n1': { exposure: null, raise: 1, add: ['rain'], remove: [] } } } }),
  takeFromPile: (t) => explorationCommands.takeFromPile('p', 'found', 'a', 'belt', 'quick')({ ...t, exploration: { ...t.exploration, piles: { p: [ItemSchema.parse({ id: 'found', name: 'Ration', type: 'food', food: 3, amount: 1 })] } } }),
}

// `a` and `b` holding each other, nothing open.
function grappling(s: SceneState): SceneState {
  return { ...cleared(s), binds: [{ kind: 'grapple', members: ['a', 'b'], holders: ['a', 'b'], immobile: [], anchors: {} }] }
}

// A knockdown by `a` on `b`, thrown, on a frozen state each step along.
function rolledManeuver(s: SceneState): SceneState {
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'grapple', maneuver: 'knockdown' }, newId)(deepFreeze(grappling(s))))
  const committed = deepFreeze(combatCommands.commitAction(() => 5, newId)(deepFreeze(combatCommands.setTarget('b')(declared))))
  return combatCommands.rollAction(() => 3, newId)(committed)
}

// The subject with its committed strike and the evade struck off, for the
// commands that need nothing open.
function cleared(s: SceneState): SceneState {
  return withLiveActions(s, [])
}

// The one-cell move committed, followed by `b` from the next cell, and paid
// for, which opens the follow as a move of `b`'s own, on a frozen state each
// step along.
function spawnedFollow(s: SceneState): SceneState {
  const marked = { ...s, following: { b: 'a' } }
  const committed = deepFreeze(combatCommands.commitAction(() => 5, newId)(deepFreeze(declaredMove(marked))))
  const followed = deepFreeze(combatCommands.declareReaction('b', { kind: 'follow' }, newId)(committed))
  return combatCommands.payAction(newId, () => 5)(followed)
}

// A charged grenade of `a`'s, thrown past the wall, landed with nobody
// avoiding it and waiting to go off, on a frozen state a few commands along.
function rolledExplosion(s: SceneState): SceneState {
  const charged = { ...grenadeItem, charge: { key: 'shock-explosive', effects: produceEffects(s.characters.a, SPELLS['shock-explosive'].effects) } }
  const armed = deepFreeze({ ...cleared(s), characters: { ...s.characters, a: itemCommands.holdItem(charged)(s.characters.a) } })
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'throw', itemId: charged.id, to: { q: 0, r: 3 } }, newId)(armed))
  return combatCommands.payAction(newId, () => 5)(deepFreeze(combatCommands.commitAction(() => 5, newId)(declared)))
}

// A cast of `a`'s sleep, rolled high enough to have HOP to spend, on a
// frozen state a few commands along.
function rolledCast(s: SceneState): SceneState {
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'cast', key: 'sleep' }, newId)(deepFreeze(cleared(s))))
  return combatCommands.commitAction(() => 30, newId)(declared)
}

// A's telepathic link at `b` cast and landed, leaving `b`'s test against it
// open, on a frozen state each step along.
function openSpellTest(s: SceneState): SceneState {
  const learned = { ...cleared(s), characters: { ...s.characters, a: { ...s.characters.a, spells: { ...s.characters.a.spells, 'telepathic-link': { method: 'intuitive' as const, practice: 0 } } } } }
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'cast', key: 'telepathic-link' }, newId)(deepFreeze(learned)))
  const committed = deepFreeze(combatCommands.commitAction(() => 5, newId)(deepFreeze(combatCommands.setTarget('b')(declared))))
  return combatCommands.resolveAction(newId, () => 5)(deepFreeze(combatCommands.rollAction(() => 30, newId)(committed)))
}

// A's rest paid for, waiting to land, on a frozen state each step along.
function paidRest(s: SceneState): SceneState {
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'rest' }, newId)(deepFreeze(cleared(s))))
  return combatCommands.commitAction(() => 5, newId)(declared)
}

// A's cast of sleep rolled to a graze the graze save carries to a hit.
function grazedCast(s: SceneState): SceneState {
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'cast', key: 'sleep' }, newId)(deepFreeze(cleared(s))))
  const test = getRootTest(declared, getOpenAction(declared)!)!
  return combatCommands.commitAction(() => test.DL - test.skill + 3, newId)(declared)
}

// The committed strike cancelled and a fresh one declared in its place, on a
// frozen state a couple of commands along, for the commands that only run
// before the commit.
function declaredStrike(s: SceneState): SceneState {
  return combatCommands.declareAction('a', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)(deepFreeze(cleared(s)))
}

// The strike cancelled and a one-cell move declared in its place, on a
// frozen state a few commands along.
function declaredMove(s: SceneState): SceneState {
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'move' }, newId)(deepFreeze(cleared(s))))
  return combatCommands.amendAction({ movement: 'crawl', path: [{ q: 1, r: 0 }] })(declared)
}

// `a`, stood up and strong, walked into `b`'s space and paid for, which leaves
// the crash's winner a space to put `b` in, on a frozen state each step along.
function crashedMove(s: SceneState): SceneState {
  const a = s.characters.a
  const strong = { ...a, afflictions: [], trainables: { ...a.trainables, STR: { ...a.trainables.STR, value: 30 } } }
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'move' }, newId)(deepFreeze({ ...cleared(s), characters: { ...s.characters, a: strong } })))
  const drawn = deepFreeze(combatCommands.amendAction({ movement: 'basic', path: [{ q: 0, r: 1 }] })(declared))
  return combatCommands.payAction(newId, () => 5)(deepFreeze(combatCommands.commitAction(() => 5, newId)(drawn)))
}

// A push by `a`, grappling `b`, declared and aimed at them — `a` stood up,
// since the prone "cannot push nor drag".
function declaredPush(s: SceneState): SceneState {
  const grappled = grappling(s)
  const standing = { ...grappled, characters: { ...grappled.characters, a: { ...grappled.characters.a, afflictions: [] } } }
  const declared = deepFreeze(combatCommands.declareAction('a', { kind: 'drag' }, newId)(deepFreeze(standing)))
  const aimed = combatCommands.setTarget('b')(declared)
  expect(getOpenAction(aimed)?.kind).toBe('drag')
  return aimed
}

// Two nodes joined by a path, an event on each; the terrain is a name the
// catalog may not have, which a node falls back from.
function mapSubject(): CrawlMap {
  const event = { custom: { name: 'wolves', stages: [{ types: ['encounter'], DL: 5, outcomes: { hit: { text: 'avoided' } } }, { name: 'gone' }] } }
  return CrawlMapSchema.parse({
    name: 'm',
    nodes: { n1: { name: 'A', terrain: 'forest', custom: { exposure: 2 }, events: { e: event } }, n2: { name: 'B', terrain: 'forest' } },
    connections: { c: { a: 'n1', b: 'n2', DL: 5, backDL: 8, events: { e: { ...event, way: 'there' } } } },
  })
}

const collectionCases: Record<string, (c: Collection) => unknown> = {
  renameCollection: (c) => collectionsModule.renameCollection('D')(c),
  setInCollection: (c) => collectionsModule.setInCollection('Wolf', false)(c),
  shareCollection: (c) => collectionsModule.shareCollection('campaigns', 'k', true)(c),
}

const mapCases: Record<string, (m: CrawlMap) => unknown> = {
  setMapName: (m) => mapModule.setMapName('n')(m),
  setMapKnowledge: (m) => mapModule.setMapKnowledge('lorien')(m),
  setNodeKnowledge: (m) => mapModule.setNodeKnowledge('n1', 'lorien')(m),
  addNode: (m) => mapModule.addNode(() => 'n3')(m),
  moveNode: (m) => mapModule.moveNode('n1', { x: 300, y: 200 })(m),
  setNode: (m) => mapModule.setNode('n1', { name: 'C' })(m),
  toggleSettlement: (m) => mapModule.toggleSettlement('n1')(m),
  setSettlementLiving: (m) => mapModule.setSettlementLiving('n1', 2)(m),
  customizeNode: (m) => mapModule.customizeNode('n1', { exposure: 1 })(m),
  customizeNodeWear: (m) => mapModule.customizeNodeWear('n1', { thirst: 1 })(m),
  toggleNodeTag: (m) => mapModule.toggleNodeTag('n1', 'cold')(m),
  resetNodeValue: (m) => mapModule.resetNodeValue('n1', 'exposure')(m),
  removeNode: (m) => mapModule.removeNode('n1')(m),
  addConnection: (m) => mapModule.addConnection('n2', 'n1', 1, 2, () => 'd')(m),
  setConnection: (m) => mapModule.setConnection('c', { backDL: 9 })(m),
  removeConnection: (m) => mapModule.removeConnection('c')(m),
  addEvent: (m) => mapModule.addEvent({ kind: 'connection', id: 'c' }, null, () => 'f')(m),
  editEvent: (m) => mapModule.editEvent({ kind: 'connection', id: 'c' }, 'e', eventModule.setEvent({ DL: 2 }))(m),
  setEventWay: (m) => mapModule.setEventWay('c', 'e', 'both')(m),
  removeEvent: (m) => mapModule.removeEvent({ kind: 'node', id: 'n1' }, 'e')(m),
}

// An event of its own: a deer, with meat to find.
const eventSubject = (): CrawlEvent => CrawlEventSchema.parse({ custom: { name: 'deer', types: ['food'], DL: 5, outcomes: { hit: { items: [{ key: 'Meat', amount: 2 }] } } } })

const eventCases: Record<string, (e: CrawlEvent) => unknown> = {
  setEvent: (e) => eventModule.setEvent({ name: 'elk', DL: 0 })(e),
  toggleEventType: (e) => eventModule.toggleEventType('water')(e),
  setOutcome: (e) => eventModule.setOutcome('miss', { stop: true, wear: { IL: 1, exhaustion: 0, hunger: 0, thirst: 0 } })(e),
  takeItems: (e) => eventModule.takeItems(e),
  resetEventValue: (e) => eventModule.resetEventValue('DL')({ ...e, template: 'Deer' }),
}

function combatSubject(): SceneState {
  const a = { ...characterSubject(), id: 'a' }
  const b = { ...characterSubject(), id: 'b' }
  const strike = { kind: 'strike', id: 's1', actorId: 'a', targetId: 'b', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic', step: 'react' }
  const evade = { kind: 'evade', id: 'r1', actorId: 'b', targetId: 'a', reactionTo: 's1' }
  return {
    ...SceneStateSchema.parse({
      actions: { s1: strike, r1: evade },
      live: ['s1', 'r1'],
      stack: ['s1'],
      board: { placements: { a: { cell: { q: 0, r: 0 } }, b: { cell: { q: 0, r: 1 } } }, terrain: { '2,0': { blocking: true } } },
    }),
    characters: { a, b },
    inTurnCharacter: 'a',
    round: 3,
  }
}

function campaignSubject(fight: SceneState): CampaignState {
  const tired = { ...fight.characters, a: { ...fight.characters.a, resources: { ...fight.characters.a.resources, exhaustion: 14 } } }
  return CampaignStateSchema.parse({
    characters: tired, partyOf: { a: 'p', b: 'p' }, maps: { m: mapSubject() }, journal: [{ id: '1', party: 'p', clock: 100, lines: ['x'] }],
    parties: { p: { name: 'Party 1', at: { map: 'm', node: 'n1' }, clock: 100, active: true } },
  })
}

describe('commands are pure updaters', () => {
  it.each(Object.entries({ ...characterCases, ...itemCases }))('%s leaves its character alone', (_name, run) => {
    const subject = characterSubject()
    const pristine = structuredClone(subject)
    run(deepFreeze(subject))
    expect(subject).toEqual(pristine)
  })

  it.each(Object.entries(creationCases))('%s leaves its draft alone', (_name, run) => {
    const subject = creationSubject()
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

  it.each(Object.entries(collectionCases))('%s leaves its collection alone', (_name, run) => {
    const subject = CollectionSchema.parse({ id: 'c', owner: 'o', kind: 'characters', name: 'C', keys: ['Wolf'] })
    const pristine = structuredClone(subject)
    run(deepFreeze(subject))
    expect(subject).toEqual(pristine)
  })
  it.each(Object.entries(mapCases))('%s leaves its map alone', (_name, run) => {
    const subject = mapSubject()
    const pristine = structuredClone(subject)
    run(deepFreeze(subject))
    expect(subject).toEqual(pristine)
  })
  it.each(Object.entries(eventCases))('%s leaves its event alone', (_name, run) => {
    const subject = eventSubject()
    const pristine = structuredClone(subject)
    run(deepFreeze(subject))
    expect(subject).toEqual(pristine)
  })

  it.each(Object.entries(campaignCases))('%s leaves its campaign and fight alone', (_name, run) => {
    const fight = cleared(combatSubject())
    const subject = { campaign: campaignSubject(fight), fight }
    const pristine = structuredClone(subject)
    run(deepFreeze(subject))
    expect(subject).toEqual(pristine)
  })

  it.each(Object.entries(explorationCases))('%s leaves its campaign and exploration alone', (_name, run) => {
    const subject: Exploring = {
      campaign: campaignSubject(cleared(combatSubject())),
      exploration: ExplorationStateSchema.parse({
        groups: { p: { g: { kind: 'travel', members: ['b'], roller: 'b', target: 'c' } } },
        camps: { p: { at: { map: 'm', node: 'n1' }, shelter: 1, firewood: 2, fire: true } },
      }),
    }
    const pristine = structuredClone(subject)
    run(deepFreeze(subject))
    expect(subject).toEqual(pristine)
  })
})

// Downtime's subject is the campaign's beside what downtime keeps.
const downtimeCases: Record<string, (t: Downtime) => unknown> = {
  setLiving: (t) => downtimeCommands.setLiving('a', 'rich')(t),
  setHoused: (t) => downtimeCommands.setHoused('a', true)(t),
  chooseTraining: (t) => downtimeCommands.chooseTraining('a', { kind: 'trainable', key: 'strike' }, false)(t),
  chooseActivity: (t) => downtimeCommands.chooseActivity('a', 'job')(t),
  setBlock: (t) => downtimeCommands.setBlock('a', { XP: 2 })(t),
  setLearningGain: (t) => downtimeCommands.setLearningGain('a', 1, 2)(t),
  decideTraining: (t) => downtimeCommands.decideTraining('a', 'accepted')(t),
  dropBlock: (t) => downtimeCommands.dropBlock('a')(t),
  passDays: (t) => downtimeCommands.passDays(2)(t),
  answerDowntime: (t) => downtimeCommands.answerDowntime('self:a', 4, 'entered')({ ...t, downtime: { ...t.downtime, passing: 2, calls: { 'self:a': { id: 'self:a', roller: 'a', label: 'training alone', explodes: false, test: { skill: 0, DL: 5, scale: 'degrees', grazes: false }, mode: 'normal', die: null, source: 'screen' } } } }),
  toExploration: (t) => downtimeCommands.toExploration('p')(t),
}

describe('downtime commands are pure', () => {
  it.each(Object.entries(downtimeCases))('%s leaves its campaign and downtime alone', (_name, run) => {
    const subject: Downtime = {
      campaign: { ...campaignSubject(cleared(combatSubject())), parties: {}, partyOf: {} },
      downtime: DowntimeStateSchema.parse({
        plans: { a: { block: { kind: 'training', target: { kind: 'trainable', key: 'strike' }, rate: 4 }, elapsed: 0 } },
      }),
    }
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
    ['campaign', campaignCommands, campaignCases],
    ['exploration', explorationCommands, explorationCases],
    ['downtime', downtimeCommands, downtimeCases],
    ['map', mapModule, mapCases],
    ['event', eventModule, eventCases],
    ['collection', collectionsModule, collectionCases],
    ['creation', creationCommands, creationCases],
  ] as const)('%s commands all have a purity case', (_family, module, cases) => {
    const uncovered = Object.entries(module)
      .filter(([name, value]) => typeof value === 'function' && !(name in cases) && !NOT_UPDATERS.has(name))
      .map(([name]) => name)
    expect(uncovered).toEqual([])
  })
})
