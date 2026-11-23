import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { ScenePresetSchema } from '../domain/campaign/types'
import { newBoardMap, paintSpawnBoardMap } from '../domain/scene/commands/boardMapEdit'
import { playDemo } from '../domain/scene/commands/demo'

// Spawn areas (the user's ruling, 2026-11-23): until the fight starts, a party
// of a prepared scene is placed by hand only in the area of the battle map the
// scene gives it. The view marks the areas, and a click must agree with it.

const standsAt = (h: Harness, name: string) => h.view().cells.filter((c) => c.occupants.includes(h.idOf(name))).map((c) => c.key)

// Ann and Bob, to be placed in area 1, against Cy and Di, already standing in
// area 2, on a map whose areas were painted with the editor's brush.
function scene(): Harness {
  const map = [paintSpawnBoardMap({ q: -4, r: 0 }, 1, 1), paintSpawnBoardMap({ q: 4, r: 0 }, 2, 1)].reduce((m, paint) => paint(m), newBoardMap(6))
  const preset = ScenePresetSchema.parse({
    parties: [
      { name: 'Ours', spawn: 1, visitor: true },
      { name: 'Theirs', spawn: 2, members: [{ key: 'Cy' }, { key: 'Di' }] },
    ],
  })
  const sheets = Object.fromEntries(['Ann', 'Bob', 'Cy', 'Di'].map((name) => [name, { name }]))
  let n = 0
  const made = playDemo(preset, ['Ann', 'Bob'], map, sheets, () => `x${++n}`)
  if (!made) throw new Error('the scene has no party for the visitor')
  const h = openHarness()
  h.press(() => made.table.fight)
  return h
}

describe('placing by hand in a spawn area', () => {
  it('puts the character on a free cell the board marks as their area, and leaves them where they were otherwise', () => {
    const h = scene()
    const area = h.view().cells.filter((c) => c.spawn === 1).map((c) => c.key)
    expect(area.length).toBeGreaterThan(0)
    h.select('Ann')
    for (const cell of h.view().cells) {
      const before = standsAt(h, 'Ann')
      h.cell(cell.cell.q, cell.cell.r)
      const free = cell.occupants.length === 0 || cell.occupants.includes(h.idOf('Ann'))
      expect(standsAt(h, 'Ann')).toEqual(area.includes(cell.key) && free ? [cell.key] : before)
    }
  })

  it('stands the other party in its own area', () => {
    const h = scene()
    const area = h.view().cells.filter((c) => c.spawn === 2).map((c) => c.key)
    for (const name of ['Cy', 'Di']) {
      expect(standsAt(h, name)).toHaveLength(1)
      expect(area).toEqual(expect.arrayContaining(standsAt(h, name)))
    }
  })
})
