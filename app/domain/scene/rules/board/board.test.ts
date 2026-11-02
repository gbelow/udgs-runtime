import { describe, it, expect } from 'vitest'
import { BoardSchema, SceneStateSchema, StrikeActionSchema, TerrainCellSchema, type Board, type SceneState } from '../../types'
import { makeCampaignCharacter } from '../../../factories'
import type { CampaignCharacter } from '../../../types'
import { ACTIONS, isReaction } from '../actionCatalog'
import type { ActionKind } from '../../types'
import { getAvailableActions } from '../options'
import { getDLTerms } from '../attack'
import { getTargetIds } from '../action'
import { getOpenAction } from '../log'
import { LEVEL_EYES, firesAcross, getMeleeGap, getStrikeReach, isStepWalled, seesAcross } from './board'
import { DIRECTIONS, add, hexCorner, sameCell, toPlane } from './geometry'
import { declareAction as declareOwnAction, setTarget } from '../../commands/action'
import { getCatalogItem, getItemScale } from '../../../item/rules/items'
import { getWieldedWeapons } from '../../../item/rules/hands'

// Each action below is declared in its actor's own turn (play.tex "Combat").
const declareAction = (...[actorId, draft, newId]: Parameters<typeof declareOwnAction>) => (s: SceneState) =>
  declareOwnAction(actorId, draft, newId)({ ...s, inTurnCharacter: actorId })

function fighter(id: string, extra: Record<string, unknown> = {}): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id, ...extra })
  return { ...base, id, resources: { ...base.resources, AP: 8, STA: 6 } }
}

function combat(board: Board | null, ...characters: CampaignCharacter[]): SceneState {
  return { ...SceneStateSchema.parse({ board }), characters: Object.fromEntries(characters.map((c) => [c.id, c])) }
}

let n = 0
const newId = () => `a${++n}`

// The board's contract (`SceneStateSchema`): a fight with no board is a
// fight in which every positional gate passes. So it must read exactly like
// a fight on a board where nothing positional is in the way — attacker and
// defender adjacent on flat ground, every cell open.
describe('a fight without a board is a fight where every positional gate passes', () => {
  const open: Board = {
    placements: {
      atk: { cell: { q: 0, r: 0 }, orientation: 0, elevation: 0, depth: 0, focus: null, climb: null },
      def: { cell: { q: 1, r: 0 }, orientation: 0, elevation: 0, depth: 0, focus: null, climb: null },
    },
    terrain: {},
    levels: [],
    pieces: {},
    surface: null,
    light: 'bright',
    origin: { q: 0, r: 0 },
    extent: { q: 6, r: 6, s: 6 },
  }

  function declared(board: Board | null): SceneState {
    let s = combat(board, fighter('atk'), fighter('def'))
    s = declareAction('atk', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)(s)
    return setTarget('def')(s)
  }

  it('offers the same targets', () => {
    const [bare, placed] = [declared(null), declared(open)]
    expect(getTargetIds(bare, getOpenAction(bare)!)).toEqual(getTargetIds(placed, getOpenAction(placed)!))
  })

  it('scores against the same DL', () => {
    const [bare, placed] = [declared(null), declared(open)]
    expect(getDLTerms(bare, getOpenAction(bare)!)).toEqual(getDLTerms(placed, getOpenAction(placed)!))
  })

  // A reaction may come as one option per way of doing it (a jump per
  // landing cell), so what is compared is how open the kind is, not how
  // many ways it offers.
  const reactions = (Object.keys(ACTIONS) as ActionKind[]).filter(isReaction)
  it.each(reactions)('leaves "%s" as open as it is on open ground', (kind) => {
    const [bare, placed] = [declared(null), declared(open)]
    const pick = (s: SceneState) =>
      [...new Set(getAvailableActions(s, 'def').filter((o) => o.draft.kind === kind).map((o) => `${o.available}:${o.reason}`))].sort()
    expect(pick(bare)).toEqual(pick(placed))
  })
})

// Ruling: gear.tex "Short, Long I/II" gives a reach of 1m x RM, which for
// the smallest weapons comes to less than a cell; the table's decision is
// that a strike always reaches an adjacent target.
describe('reach never falls under a cell', () => {
  const daggers = [1, 2, 3, 4, 5, 6, 7].map((scale) => getCatalogItem('Dagger', 1, scale)!)
  it.each(daggers.map((item) => [getItemScale(item), item] as const))('a dagger of scale %i', (_scale, item) => {
    const atk = fighter('atk', {
      held: [item],
      body: [{ id: 'left', name: 'left', location: 'hand', naturalWeapon: 'Unarmed', grip: true, itemId: item.id, lost: false }, { id: 'right', name: 'right', location: 'hand', naturalWeapon: 'Unarmed', grip: true, itemId: '', lost: false }],
    })
    const s = combat(null, atk, fighter('def'))
    const [row] = getWieldedWeapons(atk).filter((w) => w.key !== 'natural:Unarmed')
    const action = StrikeActionSchema.parse({ id: 'x', kind: 'strike', actorId: 'atk', weaponKey: row.key, attack: row.weapon.attacks[0].name })
    const reach = getStrikeReach(s, action)
    expect(reach).not.toBeNull()
    expect(reach!).toBeGreaterThanOrEqual(1)
  })
})

// The chord-wall rulings: a cell with a thin wall is stood in from its open
// side, and a line is checked against the wall itself, so whatever lies past
// a chord's line, on the side of the corner it cuts off, is walled off from
// the cell, and a wall on a side shuts the neighbour that side faces; nothing
// else is: steps, sight, shots and blows. Glass is seen through and stops a
// shot and a blow.
describe('a thin wall closes its cell to the side it stands on', () => {
  const centre = { q: 0, r: 0 }
  const beyond = (corner: number, cell: typeof centre) => {
    const [at, to] = [toPlane(cell), hexCorner(corner)]
    return at.x * to.x + at.y * to.y > 0.5
  }
  const walls = [
    ...[0, 1, 2, 3, 4, 5].map((corner) => ({ name: `corner ${corner}`, wall: { chords: [corner] }, shuts: (cell: typeof centre) => beyond(corner, cell) })),
    ...[0, 1, 2, 3, 4, 5].map((side) => ({ name: `side ${side}`, wall: { sides: [side] }, shuts: (cell: typeof centre) => sameCell(cell, add(centre, DIRECTIONS[side])) })),
  ]
  for (const { name, wall: painted, shuts } of walls) {
    for (const transparent of [false, true]) {
      const wall = TerrainCellSchema.parse({ ...painted, transparent })
      const board = BoardSchema.parse({ terrain: { '0,0': wall } })
      for (const way of DIRECTIONS) {
        const near = add(centre, way)
        const far = add(near, way)
        const closed = shuts(near)
        it(`${name}${transparent ? ', glass,' : ''} toward ${near.q},${near.r}`, () => {
          expect(isStepWalled((cell) => board.terrain[`${cell.q},${cell.r}`], near, centre)).toBe(closed)
          expect(isStepWalled((cell) => board.terrain[`${cell.q},${cell.r}`], centre, near)).toBe(closed)
          expect(seesAcross(board, [far], [centre], LEVEL_EYES)).toBe(!closed || transparent)
          expect(firesAcross(board, [far], [centre], LEVEL_EYES)).toBe(!closed)
          const body = (cell: typeof centre) => ({ footprint: [cell], feet: 0, height: 2 })
          expect(getMeleeGap(board, body(near), body(centre)) <= 1).toBe(!closed)
        })
      }
    }
  }
})
