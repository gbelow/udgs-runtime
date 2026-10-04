import { CombatStateSchema, type CombatState } from '../combat/types'
import { makeCampaignCharacter } from '../factories'
import { ItemSchema, type CampaignCharacter } from '../types'
import { holdItem, regripItem } from '../item/commands/hands'
import { addItemToContainer } from '../item/commands/items'
import { putOnFromCatalog } from '../item/commands/containers'
import { getCatalogItem } from '../item/rules/items'

// Fighters and boards for the bots' test and simulator to play with.

export function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, fightName: id, resources: { ...base.resources, AP: 12, STA: 6 } }
}

export function spearman(id: string): CampaignCharacter {
  const spear = ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })
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

// A caster holding a flamethrower (spells.tex "Flamethrower"), the focus surge
// spent, with the spells that ask for nothing in hand besides.
export function mage(id: string): CampaignCharacter {
  const flamethrower = ItemSchema.parse({ name: 'Flamethrower', type: 'magical', bulk: 2, source: { damage: [{ kind: 'burn', value: 15 }], ammo: 20 } })
  const known = Object.fromEntries(['flamethrower', 'telepathic-link', 'pain', 'frighten', 'sleep'].map((key) => [key, { method: 'intuitive' as const, practice: 0 }]))
  return { ...holdItem(flamethrower)(fighter(id)), spells: known, usedSurge: 'focus' }
}

// A fighter with a gauntlet in hand, which grabs (gear.tex "Grapple I/II").
export function brawler(id: string): CampaignCharacter {
  const gauntlet = ItemSchema.parse({ name: 'Gauntlet', type: 'weapon', refId: 'Gauntlet', bulk: 1 })
  return holdItem(gauntlet)(fighter(id))
}

// The abilities that open a defence the bare fighter has no answer with: the
// counterattack, the reflexes, the jump and the defender's guard.
export function trained(c: CampaignCharacter): CampaignCharacter {
  return { ...c, abilities: [...c.abilities, 'counterattack', 'precise-reflexes', 'precise-evasion', 'archer-s-reflexes', 'jumper', 'defender'] }
}

// A spear in one hand and a shield in the other, trained: every defence is
// open to them, a guard against a shot among them (combat.tex "Guard").
export function warden(id: string): CampaignCharacter {
  const spear = ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })
  const shield = ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 2 })
  return trained(regripItem(shield.id, 1)(holdItem(shield)(regripItem(spear.id, 1)(holdItem(spear)(fighter(id))))))
}

export function board(placements: Record<string, [number, number]>, ...characters: CampaignCharacter[]): CombatState {
  const cells = Object.fromEntries(Object.entries(placements).map(([id, [q, r]]) => [id, { cell: { q, r } }]))
  return { ...CombatStateSchema.parse({ board: { placements: cells } }), characters: Object.fromEntries(characters.map((c) => [c.id, c])) }
}
