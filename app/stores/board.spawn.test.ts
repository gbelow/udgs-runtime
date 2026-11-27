import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { ScenePresetSchema } from '../domain/campaign/types'
import { newBoardMap } from '../domain/scene/commands/boardMapEdit'
import { paintPresetSpawn } from '../domain/scene/commands/presetSpawn'
import { playDemo } from '../domain/scene/commands/demo'

// Spawn areas (the user's ruling, 2026-11-23): until the fight starts, a party
// of a prepared scene is placed by hand only in the area the scene painted for
// it over its battle map. The view marks the areas, and a click must agree.

const standsAt = (h: Harness, name: string) => h.view().cells.filter((c) => c.occupants.includes(h.idOf(name))).map((c) => c.key)

// Ann and Bob, to be placed in the first party's area, against Cy and Di,
// already standing in the second's, both painted with the scene editor's brush.
function scene(): { h: Harness; party: string } {
  const map = newBoardMap(6)
  const parties = ScenePresetSchema.parse({
    parties: [
      { name: 'Ours', visitor: true },
      { name: 'Theirs', members: [{ key: 'Cy' }, { key: 'Di' }] },
    ],
  })
  const preset = [paintPresetSpawn(map, 0, { q: -4, r: 0 }, 1), paintPresetSpawn(map, 1, { q: 4, r: 0 }, 1)].reduce((p, paint) => paint(p), parties)
  const sheets = Object.fromEntries(['Ann', 'Bob', 'Cy', 'Di'].map((name) => [name, { name }]))
  let n = 0
  const made = playDemo(preset, [{ picks: ['Ann', 'Bob'], you: true }, { picks: ['Cy', 'Di'], you: false }], map, sheets, () => `x${++n}`)
  if (!made?.party) throw new Error('the scene has no party for the visitor')
  const h = openHarness()
  h.press(() => made.table.fight)
  return { h, party: made.party }
}

describe('placing by hand in a spawn area', () => {
  it('puts the character on a free cell the board marks as their area, and leaves them where they were otherwise', () => {
    const { h } = scene()
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
    const { h } = scene()
    const area = h.view().cells.filter((c) => c.spawn === 2).map((c) => c.key)
    for (const name of ['Cy', 'Di']) {
      expect(standsAt(h, name)).toHaveLength(1)
      expect(area).toEqual(expect.arrayContaining(standsAt(h, name)))
    }
  })

  it('puts everyone of the party not yet placed in its own area at the press that places the rest', () => {
    const { h, party } = scene()
    const area = h.view().cells.filter((c) => c.spawn === 1).map((c) => c.key)
    h.send({ kind: 'placeParty', args: [party] })
    for (const name of ['Ann', 'Bob']) {
      expect(standsAt(h, name)).toHaveLength(1)
      expect(area).toEqual(expect.arrayContaining(standsAt(h, name)))
    }
  })
})
