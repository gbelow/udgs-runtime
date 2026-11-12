import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { makeCampaignCharacter } from '../../app/domain/factories'
import type { CampaignCharacter } from '../../app/domain/types'
import { holdItem } from '../../app/domain/item/commands/hands'
import { getSTA } from '../../app/domain/character/rules/characteristics'
import { ROUND_AP } from '../../app/domain/tables'
import { getCatalogItem } from '../../app/domain/item/rules/items'

export const CATALOG = path.join(process.cwd(), 'app/assets/characters')

// "Human Warrior:Longsword" is the catalog's Human Warrior holding a longsword
// in both hands; "Human Warrior:Short Spear+Wooden Shield" a spear in one hand
// and a shield in the other. Without gear named, the catalog character holds
// what the catalog gives them. Armor and the rest are the catalog character's.
// They begin the round rested: a full round of AP and full STA.
export function buildFighter(id: string, spec: string, label: string): CampaignCharacter {
  const [who, gear = ''] = spec.split(':')
  const file = path.join(CATALOG, `${who}.json`)
  if (!existsSync(file)) throw new Error(`No catalog character "${who}"`)
  const [weapon, shield] = gear.split('+')
  const loaded = makeCampaignCharacter(JSON.parse(readFileSync(file, 'utf-8')))
  const name = `${label}: ${weapon || who}`
  const rested = { ...loaded, id, name, fightName: name, resources: { ...loaded.resources, AP: ROUND_AP, STA: getSTA(loaded) } }
  if (!weapon) return rested
  const base = { ...rested, held: [], body: rested.body.map((part) => ({ ...part, itemId: '' })) }
  const item = getCatalogItem(weapon)
  if (!item) throw new Error(`No catalog item "${weapon}"`)
  const gripped = holdItem({ ...item, id: `${id}-weapon` }, shield ? 1 : 2)(base)
  if (!shield) return gripped
  const off = getCatalogItem(shield)
  if (!off) throw new Error(`No catalog item "${shield}"`)
  return holdItem({ ...off, id: `${id}-offhand` })(gripped)
}
