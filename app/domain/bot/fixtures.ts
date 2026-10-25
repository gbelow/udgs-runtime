import { SceneStateSchema, type SceneState } from '../scene/types'
import { makeCampaignCharacter } from '../factories'
import { ItemSchema, type CampaignCharacter } from '../types'
import { holdItem, regripItem } from '../item/commands/hands'
import { addItemToContainer } from '../item/commands/items'
import { putOnFromCatalog } from '../item/commands/containers'
import { getCatalogItem } from '../item/rules/items'
import { grantAbility } from '../character/commands/abilities'
import { makeName } from '../instances'

// Fighters and boards for the bots' test and simulator to play with.

export function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, resources: { ...base.resources, AP: 12, STA: 6 } }
}

const shortSpear = () => ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })

export function spearman(id: string): CampaignCharacter {
  const spear = shortSpear()
  return regripItem(spear.id, 2)(holdItem(spear)(fighter(id)))
}

// A shooter with a bow in both hands, the focus surge spent (combat.tex
// "Focus surge": "required to use ranged attacks") and a quiver of arrows
// slung on the belt (gear.tex "Quiver").
export function archer(id: string): CampaignCharacter {
  const bow = ItemSchema.parse({ name: 'Short Bow', type: 'weapon', refId: 'Short Bow', bulk: 2 })
  const arrows = ItemSchema.parse({ id: 'arrows', name: 'Broadhead Arrow', type: 'ammo', refId: 'Broadhead Arrow', bulk: 0, amount: 20 })
  const quiver = getCatalogItem('Quiver')!
  const belted = putOnFromCatalog(getCatalogItem('Belt')!)(fighter(id))
  const { containers } = addItemToContainer(quiver.id, 'quick', arrows)(addItemToContainer('Belt', 'quick', quiver)(belted))
  return { ...(regripItem(bow.id, 2)(holdItem(bow)({ ...fighter(id), containers }))), usedSurge: 'focus' }
}

// The archer with an empty crossbow instead and bolts in the quiver, which
// must be reloaded before every shot (gear.tex "Reload").
export function crossbowman(id: string): CampaignCharacter {
  const crossbow = ItemSchema.parse({ name: 'Crossbow', type: 'weapon', refId: 'Crossbow', bulk: 3 })
  const bolts = ItemSchema.parse({ id: 'bolts', name: 'Bodkin Bolt', type: 'ammo', refId: 'Bodkin Bolt', bulk: 0, amount: 20 })
  const quiver = getCatalogItem('Quiver')!
  const belted = putOnFromCatalog(getCatalogItem('Belt')!)(fighter(id))
  const { containers } = addItemToContainer(quiver.id, 'quick', bolts)(addItemToContainer('Belt', 'quick', quiver)(belted))
  return { ...(regripItem(crossbow.id, 2)(holdItem(crossbow)({ ...fighter(id), containers }))), usedSurge: 'focus' }
}

// A caster holding a flamethrower (spells.tex "Flamethrower"), the focus surge
// spent, with the spells that ask for nothing in hand besides, the morale
// spells and Spiritual Strike among them, the healing spells cast in a
// round and one that takes an ET, and synesthesia for those that reach
// every mind it takes in (abilities.tex "Synesthesia").
export function mage(id: string): CampaignCharacter {
  const flamethrower = ItemSchema.parse({ name: 'Flamethrower', type: 'magical', bulk: 2, source: { damage: [{ kind: 'burn', value: 15 }], ammo: 20 } })
  const spells = ['flamethrower', 'telepathic-link', 'pain', 'sleep', 'frighten', 'offend', 'pacify', 'suggestion', 'overwhelming-terror', 'provocative-mockery', 'spiritual-strike', 'defibrillate', 'clotting-touch', 'regenerate']
  const known = Object.fromEntries(spells.map((key) => [key, { method: 'intuitive' as const, practice: 6 }]))
  const caster = fighter(id)
  const senses = { ...caster.senses, synesthesia: { ...caster.senses.synesthesia, hasSense: true, range: 10 } }
  return { ...holdItem(flamethrower)({ ...caster, senses }), spells: known, usedSurge: 'focus' }
}

// A fighter with a gauntlet in hand, which grabs (gear.tex "Grapple I/II"),
// and the spirit to launch a spiritual attack with a blow that others mostly
// fail to beat (abilities.tex "Martial Spirit").
export function brawler(id: string): CampaignCharacter {
  const gauntlet = ItemSchema.parse({ name: 'Gauntlet', type: 'weapon', refId: 'Gauntlet', bulk: 1 })
  const base = fighter(id)
  const spirited = { ...base, trainables: { ...base.trainables, SPI: { ...base.trainables.SPI, value: 8 } } }
  return grantAbility('martial-spirit')(holdItem(gauntlet)(spirited))
}

// A brawler of size 4 whose three cells bend behind its head, a footprint no
// preset gives, to be turned and walked.
export function serpent(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id, size: 4, footprint: [{ q: 0, r: 0 }, { q: -1, r: 0 }, { q: -1, r: 1 }] })
  const gauntlet = ItemSchema.parse({ name: 'Gauntlet', type: 'weapon', refId: 'Gauntlet', bulk: 1 })
  return holdItem(gauntlet)({ ...base, id, resources: { ...base.resources, AP: 12, STA: 6 } })
}

// A brawler with a lit torch in the other hand (gear.tex "Torch").
export function torchbearer(id: string): CampaignCharacter {
  return holdItem(getCatalogItem('Torch')!)(brawler(id))
}

// The abilities that open a defence the bare fighter has no answer with: the
// counterattack, the reflexes, the jump and the defender's guard.
export function trained(c: CampaignCharacter): CampaignCharacter {
  return (['counterattack', 'precise-reflexes', 'precise-evasion', 'archer-s-reflexes', 'jumper-1', 'defender'] as const).reduce<CampaignCharacter>((acc, key) => grantAbility(key)(acc), c)
}

// The melee abilities that change what the fighter declares or pays: a
// gentle grapple test, the disarm after an intercept, a strike out of the
// movement surge, a cheaper braced blow, a sturdier blade, a lunge, a jump
// up off the ground, a tackle and the grappling attack.
export function meleeTrained(c: CampaignCharacter): CampaignCharacter {
  return (['gentle-art', 'clinch', 'charge', 'pikeman', 'blade-alignment', 'lunge', 'technical-lift', 'tackle', 'grappling-combat'] as const).reduce<CampaignCharacter>((acc, key) => grantAbility(key)(acc), c)
}

// A brawler with a short sword in the other hand, which intercepts and is
// bladed.
export function swordBrawler(id: string): CampaignCharacter {
  return holdItem(ItemSchema.parse({ name: 'Short Sword', type: 'weapon', refId: 'Short Sword', bulk: 1 }))(brawler(id))
}

// A spear in one hand and a shield in the other, trained: every defence is
// open to them, a guard against a shot among them (combat.tex "Guard").
export function warden(id: string): CampaignCharacter {
  const spear = shortSpear()
  const shield = ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 2 })
  return trained(regripItem(shield.id, 1)(holdItem(shield)(regripItem(spear.id, 1)(holdItem(spear)(fighter(id))))))
}

// The warden with a body shield instead, which a guard may take total cover
// behind (gear.tex "Shields", combat.tex "Cover").
export function towerWarden(id: string): CampaignCharacter {
  const spear = shortSpear()
  const shield = ItemSchema.parse({ name: 'Wooden Tower', type: 'weapon', refId: 'Wooden Tower', bulk: 2 })
  return trained(regripItem(shield.id, 1)(holdItem(shield)(regripItem(spear.id, 1)(holdItem(spear)(fighter(id))))))
}

// A thrower with a grenade in one hand and a potion in the other (gear.tex
// "Grenade", "Darkseeing").
export function bomber(id: string): CampaignCharacter {
  const grenade = ItemSchema.parse({ name: 'Grenade', type: 'weapon', refId: 'Grenade', bulk: 1 })
  return holdItem(getCatalogItem('Darkseeing')!)(holdItem(grenade)(fighter(id)))
}

// A brawler who knows medicine and is bleeding already, so that First Aid
// and Cauterization have someone to tend from the start (abilities.tex
// "Medicine").
export function medic(id: string): CampaignCharacter {
  const base = brawler(id)
  const schooled = { ...base, trainables: { ...base.trainables, medicine: { ...base.trainables.medicine, value: 1 } }, injuries: { ...base.injuries, bleed: 2 } }
  return (['first-aid', 'cauterization'] as const).reduce<CampaignCharacter>((acc, key) => grantAbility(key)(acc), schooled)
}

// A thrower with a net in both hands (gear.tex "Net").
export function netter(id: string): CampaignCharacter {
  const net = ItemSchema.parse({ name: 'Net', type: 'weapon', refId: 'Net', bulk: 2 })
  return regripItem(net.id, 2)(holdItem(net)(fighter(id)))
}

export function board(placements: Record<string, [number, number]>, ...characters: CampaignCharacter[]): SceneState {
  const cells = Object.fromEntries(Object.entries(placements).map(([id, [q, r]]) => [id, { cell: { q, r } }]))
  const names = characters.reduce<Record<string, string>>((given, c) => ({ ...given, [c.id]: makeName(c.name, Object.values(given)) }), {})
  return { ...SceneStateSchema.parse({ round: 1, board: { placements: cells } }), characters: Object.fromEntries(characters.map((c) => [c.id, c])), names }
}
