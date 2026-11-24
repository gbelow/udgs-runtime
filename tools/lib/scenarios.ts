import { readFileSync } from 'node:fs'
import path from 'node:path'
import { openHarness } from '../../app/stores/boardHarness'
import { useCombatStore } from '../../app/stores/useCombatStore'
import { makeBoardMap } from '../../app/domain/scene/factories'
import { SceneStateSchema, type SceneState } from '../../app/domain/scene/types'

// Fights on a catalog battle map with catalog fighters, set up as a table sets
// one up: fighters brought in from the sidebar, the map loaded from the picker,
// each placed by a click, and the two sides made two parties. The fight is left
// before its first round.

export const ARENA = 'Arena 1'
const COMMON = ['Erthal Soldier', 'Halkir squire', 'Human Noble', 'Surbit Thief']

export type Scenario = { name: string; red: [string, [number, number]][]; blue: [string, [number, number]][] }

const side = (cells: [number, number][]): [string, [number, number]][] => COMMON.map((who, i) => [who, cells[i]])

// The north of the arena is open grass; the middle has a house with walls on
// the west and a walled square on the east, so the last scenario's sides
// stand partly out of each other's sight.
export const SCENARIOS: Scenario[] = [
  { name: 'duel, engaged', red: [['Erthal Soldier', [0, -8]]], blue: [['Surbit Thief', [1, -8]]] },
  { name: 'duel, apart', red: [['Erthal Soldier', [-6, -8]]], blue: [['Surbit Thief', [6, -8]]] },
  { name: 'four a side, open', red: side([[-5, -9], [-5, -8], [-5, -7], [-6, -7]]), blue: side([[5, -9], [5, -8], [5, -7], [6, -8]]) },
  { name: 'four a side, houses', red: side([[-6, -2], [-6, 0], [-6, 2], [-7, 1]]), blue: side([[6, -2], [6, 0], [6, 2], [7, -1]]) },
]

// The arena's: the sides a few steps apart, so that everyone is in the fight
// from the first round: four duels, three a side out in the open, and the
// three with an archer each, a few steps behind its side. The sides of three are
// not the same: the defender stands in for the soldier on red, and for the
// noble on blue. The thief is left out: its duels came down to whether its
// foe attacked or defended.
const RED = ['Erthal Defender', 'Halkir squire', 'Human Noble']
const BLUE = ['Erthal Soldier', 'Halkir squire', 'Erthal Defender']
const three = (who: string[], cells: [number, number][]): [string, [number, number]][] => who.map((name, i) => [name, cells[i]])
const red = (cells: [number, number][]) => three(RED, cells)
const blue = (cells: [number, number][]) => three(BLUE, cells)

export const CLOSE: Scenario[] = [
  { name: 'duel, soldier and squire', red: [['Erthal Soldier', [0, -8]]], blue: [['Halkir squire', [1, -8]]] },
  { name: 'duel, soldier and noble', red: [['Erthal Soldier', [0, -8]]], blue: [['Human Noble', [1, -8]]] },
  { name: 'duel, squire and noble', red: [['Halkir squire', [0, -8]]], blue: [['Human Noble', [1, -8]]] },
  { name: 'duel, defender and noble', red: [['Erthal Defender', [0, -8]]], blue: [['Human Noble', [1, -8]]] },
  { name: 'three a side, close', red: red([[-2, -9], [-2, -8], [-2, -7]]), blue: blue([[2, -9], [2, -8], [2, -7]]) },
  { name: 'four a side, archers behind', red: [...red([[-2, -9], [-2, -8], [-2, -7]]), ['Human Ranger', [-6, -8]]], blue: [...blue([[2, -9], [2, -8], [2, -7]]), ['Human Ranger', [6, -8]]] },
  // the same, the front lines 15 m apart as a fight commonly starts, each archer 3 m behind its own
  { name: 'four a side 15 m, archers behind', red: [...red([[-7, -9], [-7, -8], [-7, -7]]), ['Human Ranger', [-10, -8]]], blue: [...blue([[8, -9], [8, -8], [8, -7]]), ['Human Ranger', [11, -8]]] },
  // the user's own fight, spread out in the southwest, the nearest 15 m apart
  { name: 'three a side 15 m, southwest', red: [['Erthal Defender', [-9, 3]], ['Halkir squire', [-9, 1]], ['Human Ranger', [-10, 1]]], blue: [['Human Noble', [-1, 10]], ['Erthal Soldier', [0, 11]], ['Surbit Thief', [4, 9]]] },
  // the four a side, close, with a second archer on each side, a Surbit Thief with its long bow
  { name: 'five a side, two archers behind', red: [...red([[-2, -9], [-2, -8], [-2, -7]]), ['Human Ranger', [-6, -8]], ['Surbit Thief', [-6, -6]]], blue: [...blue([[2, -9], [2, -8], [2, -7]]), ['Human Ranger', [6, -8]], ['Surbit Thief', [6, -6]]] },
  // the three a side, each side together some 17 m apart across the open grass, in each other's sight
  { name: 'three a side, far', red: red([[-5, -9], [-6, -8], [-6, -7]]), blue: blue([[12, -9], [11, -8], [11, -7]]) },
]

const readJson = (file: string): unknown => JSON.parse(readFileSync(path.join(process.cwd(), file), 'utf-8'))

export function setUp(scenario: Scenario): { state: SceneState; red: string[]; blue: string[] } {
  const h = openHarness(() => 5)
  const ids = (who: [string, [number, number]][]) => who.map(([name, cell]) => {
    const before = new Set(Object.keys(h.state().characters))
    h.bring(readJson(`app/assets/characters/${name}.json`) as never)
    const id = Object.keys(h.state().characters).find((k) => !before.has(k))
    if (!id) throw new Error(`${name} was not brought in`)
    return { id, cell }
  })
  const red = ids(scenario.red)
  const blue = ids(scenario.blue)
  h.loadMap(makeBoardMap({ ...(readJson(`app/assets/boards/${ARENA}.json`) as object), name: ARENA }))
  for (const { id, cell } of [...red, ...blue]) {
    useCombatStore.getState().setActiveCharacter(id)
    h.cell(...cell)
    const at = h.state().board?.placements[id]?.cell
    if (!at || at.q !== cell[0] || at.r !== cell[1]) throw new Error(`${scenario.name}: could not place ${id} at ${cell}`)
  }
  for (const [name, members] of [['Red', red], ['Blue', blue]] as const) {
    const before = new Set(Object.keys(h.state().parties))
    h.send({ kind: 'createParty', args: [name] })
    const partyId = Object.keys(h.state().parties).find((k) => !before.has(k))!
    for (const { id } of members) h.send({ kind: 'moveToParty', args: [id, partyId] })
  }
  return { state: SceneStateSchema.parse(h.state()), red: red.map((m) => m.id), blue: blue.map((m) => m.id) }
}
