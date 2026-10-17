import type { Dice } from '../../play/dice'
import { editsOver, toEdit, type EditOf } from '../../registry'
import type { AbilityKey } from '../../abilities'
import type { SpellKey } from '../../spells'
import type { FootprintPreset, LimitStressAction } from '../../lists'
import type { AfflictionKey, Armor, CampaignCharacter, Character, CharacterUpdater, Characteristics, Coord, HitLocation, Injuries, Item, Knowledges, Movement, PartWound, Race, Resources, Senses, SlotKind, SpellMethod, Stance, Skills, Trainables } from '../../types'
import type { Grip } from '../../item/rules/hands'
import type { Trade } from '../../item/rules/trade'
import { isCampaignCharacter } from '../../utils'
import { characteristicLenses, knowledgeLenses, miscLenses, movementCostLenses, movementLenses, senseLenses, skillLenses } from '../lenses'
import { composeLens, makePropLens, makeResourceLens, makeTrainableNameLens } from '../lenses/factories'
import { makeSpecificKnowledgeLens } from '../lenses/knowledge'
import { tagLenses, type TagLevel } from '../lenses/tags'
import {
  addItemToContainer, dropItem, drawItem, holdItem, putOnFromCatalog, putOnFromContainer, putOnFromHands, regripItem,
  removeItemFromContainer, slingShield, storeItem, takeOffContainer, throwOffShield, trade, unslingShield,
} from '../../item/commands'
import {
  addAffliction, addBodyPart, addPartWound, addSpecificKnowledge, applyRace, doffArmor, editBodyPart, editNaturalArmor, editPartWound,
  editStance, endSurge, equipArmor, forgetAbility, forgetSpell, healWound, learnAbility, learnSpell, practiceSpell, putGauntlets, putHelm,
  releaseSpell, removeBodyPart, removePartWound, removeSpecificKnowledge, resetAllSkills, resetSkill, resistCurse, resolvePending,
  setFootprintPreset, setLimitStress, toggleAbility, toggleFootprintCell, toggleVisor, updateIL, updateSTA, useAbility, wearFromContainer,
  wearFromHands, type BodyPartEdit,
} from '.'

// The edits a sheet makes to a character, as data: each kind names the
// command it runs and takes only plain data, so that an edit made on one
// screen can be played on another. A die the edit throws is the table's
// unless one is typed in.

export type CharacterContext = { dice: Dice }

const edit = editsOver<CharacterContext, CharacterUpdater>()

// what only a campaign character carries; a base character is left alone
const campaign = (change: (c: CampaignCharacter) => CampaignCharacter): CharacterUpdater =>
  (c) => (isCampaignCharacter(c) ? change(c) : c)
const typed = (ctx: CharacterContext, die?: number | null): Dice => (die === undefined || die === null ? ctx.dice : () => die)
const injuries = makePropLens<CampaignCharacter, 'injuries'>('injuries')

export const characterCommands = {
  // the values on the sheet, set through their lenses
  setSkill: edit((_, key: keyof Skills, value: number) => (c) => skillLenses[key].set(c, value)),
  setKnowledge: edit((_, key: keyof Knowledges, value: number) => (c) => knowledgeLenses[key].set(c, value)),
  setSpecificKnowledge: edit((_, name: string, value: number) => (c) => makeSpecificKnowledgeLens(name).set(c, value)),
  setCharacteristic: edit((_, key: keyof Characteristics, value: number) => (c) => characteristicLenses[key].set(c, value)),
  setMovement: edit((_, key: keyof Movement, field: 'distance' | 'AP' | 'STA', value: number) =>
    (c) => (field === 'distance' ? movementLenses[key] : movementCostLenses[key][field]).set(c, value)),
  setSenseNumber: edit((_, key: keyof Senses, field: 'bonus' | 'penalty', value: number) => (c) => senseLenses[key][field].set(c, value)),
  setSenseRange: edit((_, key: keyof Senses, value: number | null) => (c) => senseLenses[key].range.set(c, value)),
  setSenseFlag: edit((_, key: keyof Senses, field: 'hasSense' | 'active' | 'reactive', value: boolean) => (c) => senseLenses[key][field].set(c, value)),
  setMisc: edit((_, key: keyof typeof miscLenses, value: number) => (c) => miscLenses[key].set(c, value)),
  setTrainableName: edit((_, key: keyof Trainables, name: string) => (c) => makeTrainableNameLens<Character>(key).set(c, name)),
  setTag: edit((_, level: TagLevel, tag: string) => (c) => tagLenses[level].set(c, tag)),
  setText: edit((_, key: 'name' | 'notes', text: string) => (c) => makePropLens<Character, 'name' | 'notes'>(key).set(c, text)),
  setInjury: edit((_, key: keyof Injuries, value: number) => campaign((c) => composeLens(injuries, makePropLens<Injuries, keyof Injuries>(key)).set(c, value))),
  setResource: edit((_, key: keyof Resources, value: number) => campaign((c) => makeResourceLens(key).set(c, value))),

  // the turn's state and the body's
  setLimitStress: edit((_, action: LimitStressAction | null) => setLimitStress(action)),
  endSurge: edit(() => campaign(endSurge)),
  addAffliction: edit((_, affliction: AfflictionKey) => campaign(addAffliction(affliction))),
  updateIL: edit((_, IL: number) => campaign(updateIL(IL))),
  updateSTA: edit((_, STA: number) => campaign(updateSTA(STA))),
  resetSkill: edit((_, key: keyof Skills) => resetSkill(key)),
  resetAllSkills: edit(() => resetAllSkills()),
  healWound: edit((_, index: number, amount: number) => campaign(healWound(index, amount))),
  resolvePending: edit((ctx, index: number, die?: number | null) => campaign(resolvePending(index, typed(ctx, die)))),
  resistCurse: edit((ctx, key: string, die?: number | null) => campaign(resistCurse(key, typed(ctx, die)))),

  // abilities and spells
  learnAbility: edit((_, key: AbilityKey) => learnAbility(key)),
  forgetAbility: edit((_, key: AbilityKey) => forgetAbility(key)),
  toggleAbility: edit((_, key: AbilityKey) => toggleAbility(key)),
  useAbility: edit((_, key: AbilityKey) => useAbility(key)),
  learnSpell: edit((_, key: SpellKey, method: SpellMethod) => learnSpell(key, method)),
  forgetSpell: edit((_, key: SpellKey) => forgetSpell(key)),
  practiceSpell: edit((_, key: SpellKey, delta: number) => practiceSpell(key, delta)),
  releaseSpell: edit((_, key: SpellKey) => releaseSpell(key)),
  addSpecificKnowledge: edit((_, name: string) => addSpecificKnowledge(name)),
  removeSpecificKnowledge: edit((_, name: string) => removeSpecificKnowledge(name)),

  // the creature: its race, body, stance and footprint
  applyRace: edit((_, race: Race) => applyRace(race)),
  addBodyPart: edit((_, location: HitLocation) => addBodyPart(location)),
  removeBodyPart: edit((_, id: string) => removeBodyPart(id)),
  editBodyPart: edit((_, id: string, change: BodyPartEdit) => editBodyPart(id, change)),
  addPartWound: edit((_, id: string) => addPartWound(id)),
  editPartWound: edit((_, id: string, index: number, change: Partial<PartWound>) => editPartWound(id, index, change)),
  removePartWound: edit((_, id: string, index: number) => removePartWound(id, index)),
  editStance: edit((_, change: Partial<Stance>) => editStance(change)),
  editNaturalArmor: edit((_, change: Partial<Armor>) => editNaturalArmor(change)),
  toggleFootprintCell: edit((_, cell: Coord) => toggleFootprintCell(cell)),
  setFootprintPreset: edit((_, preset: FootprintPreset) => setFootprintPreset(preset)),
}

// The moves with the character's gear, which a fight refuses outside their
// own turn (cf. `updateInventory`).
export const gearCommands = {
  equipArmor: edit((_, item: Item) => equipArmor(item)),
  doffArmor: edit((_, into: { containerKey: string; slot: SlotKind } | null) => doffArmor(into)),
  putGauntlets: edit(() => putGauntlets),
  putHelm: edit(() => putHelm),
  toggleVisor: edit(() => toggleVisor),
  putOnFromCatalog: edit((_, item: Item) => putOnFromCatalog(item)),
  takeOffContainer: edit((_, key: string) => takeOffContainer(key)),
  holdItem: edit((_, item: Item, grip: Grip) => holdItem(item, grip)),
  regripItem: edit((_, itemId: string, grip: Grip) => regripItem(itemId, grip)),
  dropItem: edit((_, itemId: string) => dropItem(itemId)),
  wearFromHands: edit((_, itemId: string) => wearFromHands(itemId)),
  putOnFromHands: edit((_, itemId: string) => putOnFromHands(itemId)),
  slingShield: edit((_, itemId: string) => slingShield(itemId)),
  unslingShield: edit(() => unslingShield()),
  throwOffShield: edit(() => throwOffShield()),
  storeItem: edit((_, itemId: string, containerKey: string, slot: SlotKind) => storeItem(itemId, containerKey, slot)),
  addItemToContainer: edit((_, containerKey: string, slot: SlotKind, item: Item) => addItemToContainer(containerKey, slot, item)),
  removeItemFromContainer: edit((_, containerKey: string, itemId: string, amount?: number) => removeItemFromContainer(containerKey, itemId, amount)),
  drawItem: edit((_, containerKey: string, itemId: string) => drawItem(containerKey, itemId)),
  wearFromContainer: edit((_, containerKey: string, itemId: string) => wearFromContainer(containerKey, itemId)),
  putOnFromContainer: edit((_, containerKey: string, itemId: string) => putOnFromContainer(containerKey, itemId)),
  trade: edit((_, t: Trade) => trade(t)),
}

export type CharacterCommand = EditOf<typeof characterCommands>
export type GearCommand = EditOf<typeof gearCommands>

export const isGearCommand = (command: CharacterCommand | GearCommand): command is GearCommand => command.kind in gearCommands

export function toCharacterUpdater(command: CharacterCommand | GearCommand, ctx: CharacterContext): CharacterUpdater {
  return toEdit<CharacterContext, CharacterUpdater>(isGearCommand(command) ? gearCommands : characterCommands, command, ctx)
}
