import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { CombatState } from '../../app/domain/combat/types'
import type { CampaignCharacter } from '../../app/domain/types'
import type { Party } from '../../app/domain/bot/party'
import { makeCampaignCharacter } from '../../app/domain/factories'
import { addCharacterToCombat } from '../../app/domain/combat/factories'
import { board } from '../../app/domain/bot/fixtures'

// Fights for the simulator to play, made of the catalog's characters
// (app/assets/characters). A matchup is a list of sides, each a list of
// catalog names — `Name*2` for two of one — and a bot plays every side.

const CATALOG = path.join(process.cwd(), 'app/assets/characters')

export type Matchup = {
  name: string
  sides: string[][]
  // cells between one side's line and the next
  distance: number
}

export type Scenario = {
  name: string
  about: string
  build: () => { state: CombatState; parties: Party[]; labels: string[] }
}

export const PRESETS: Matchup[] = [
  { name: 'mirror', sides: [['Human Warrior'], ['Human Warrior']], distance: 6 },
  { name: 'ranged', sides: [['HumanRanger'], ['Human Warrior']], distance: 8 },
  { name: 'ogre', sides: [['Ogre'], ['Human Warrior*2']], distance: 6 },
]

export function listCatalog(): string[] {
  return readdirSync(CATALOG).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length))
}

function loadCatalogCharacter(name: string): CampaignCharacter {
  const file = path.join(CATALOG, `${name}.json`)
  try {
    return makeCampaignCharacter(JSON.parse(readFileSync(file, 'utf-8')))
  } catch {
    throw new Error(`No catalog character "${name}". Available: ${listCatalog().join(', ')}`)
  }
}

// "Human Warrior*2" is two of them.
function expand(entry: string): string[] {
  const [, name, count] = /^(.*?)(?:\*(\d+))?$/.exec(entry.trim())!
  return Array<string>(Number(count ?? 1)).fill(name)
}

function labelOf(names: string[]): string {
  const counts = names.reduce<Map<string, number>>((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map())
  return [...counts].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(' + ')
}

// Each side stands on a line of its own, `distance` cells from the last, its
// members one row apart.
export function makeScenario({ name, sides, distance }: Matchup): Scenario {
  const named = sides.map((entries) => entries.flatMap(expand))
  const labels = named.map(labelOf)
  return {
    name,
    about: `${labels.join(' vs ')}, ${distance} cells apart, a bot each`,
    build: () => {
      let n = 0
      const newId = () => `c${++n}`
      const characters: CampaignCharacter[] = []
      const placements: Record<string, [number, number]> = {}
      const parties = named.map((names, side): Party => ({
        members: names.map((catalogName, row) => {
          const added = addCharacterToCombat({ ...loadCatalogCharacter(catalogName), id: newId() }, Object.fromEntries(characters.map((c) => [c.id, c])), newId)
          characters.push(added)
          placements[added.id] = [side * distance, row]
          return added.id
        }),
      }))
      return { state: board(placements, ...characters), parties, labels }
    },
  }
}
