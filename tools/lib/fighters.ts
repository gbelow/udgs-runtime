import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { makeCampaignCharacter } from '../../app/domain/factories'
import type { CampaignCharacter } from '../../app/domain/types'
import { holdItem } from '../../app/domain/item/commands/hands'
import { getCatalogItem } from '../../app/domain/item/rules/items'

export const CATALOG = path.join(process.cwd(), 'app/assets/characters')

// "Human Warrior:Longsword" is the catalog's Human Warrior holding a longsword
// in both hands; "Human Warrior:Short Spear+Wooden Shield" a spear in one hand
// and a shield in the other. Armor and the rest are the catalog character's.
export function buildFighter(id: string, spec: string, label: string): CampaignCharacter {
  const [who, gear = ''] = spec.split(':')
  const file = path.join(CATALOG, `${who}.json`)
  if (!existsSync(file)) throw new Error(`No catalog character "${who}"`)
  const [weapon, shield] = gear.split('+')
  const loaded = makeCampaignCharacter(JSON.parse(readFileSync(file, 'utf-8')))
  const name = `${label}: ${weapon || who}`
  const base = { ...loaded, id, name, fightName: name, held: [], body: loaded.body.map((part) => ({ ...part, itemId: '' })) }
  if (!weapon) return base
  const item = getCatalogItem(weapon)
  if (!item) throw new Error(`No catalog item "${weapon}"`)
  const gripped = holdItem({ ...item, id: `${id}-weapon` }, shield ? 1 : 2)(base)
  if (!shield) return gripped
  const off = getCatalogItem(shield)
  if (!off) throw new Error(`No catalog item "${shield}"`)
  return holdItem({ ...off, id: `${id}-offhand` })(gripped)
}
