import { describe, it, expect } from 'vitest'
import { makeStructure, mapOfStructure, structureOfMap } from './factories'
import { StructureSchema } from './types'

// A structure is read from storage (a file, a Redis field) and opened in the
// editor as a small battle map, so reading one is total, settles in one pass,
// survives the trip through JSON, and an editor that changes nothing keeps it
// as it was.

const HOSTILE: { label: string; raw: unknown }[] = [
  { label: 'null', raw: null },
  { label: 'a string', raw: 'house' },
  { label: 'an array', raw: [] },
  { label: 'an empty object', raw: {} },
  { label: 'terrain that is not a map', raw: { terrain: 3 } },
  { label: 'terrain keyed by something that is not a cell', raw: { terrain: { door: { blocking: true } } } },
  { label: 'levels that are not a list', raw: { levels: 'up' } },
  { label: 'a cell marked as a piece', raw: { terrain: { '0,0': { piece: 'shed' } }, levels: [{ piece: 'shed' }] } },
  { label: 'a fire left on a cell', raw: { terrain: { '0,0': { layers: [{ fire: 2 }] } } } },
]

const house = () => makeStructure({
  name: 'house',
  terrain: { '0,0': { elevation: 0.5 }, '4,-1': { blocking: true, RES: 10 }, '-2,1': { blocking: true, transparent: true } },
  levels: [{ floor: 3, height: 3, terrain: { '0,0': { hole: true }, '1,0': {}, '-5,2': { blocking: true } } }],
})

describe('reading a structure', () => {
  for (const { label, raw } of HOSTILE) {
    it(`${label} yields a valid structure that settles in one pass`, () => {
      const structure = makeStructure(raw)
      expect(StructureSchema.parse(structure)).toEqual(structure)
      expect(makeStructure(structure)).toEqual(structure)
    })
  }

  it('round-trips through JSON', () => {
    expect(makeStructure(JSON.parse(JSON.stringify(house())))).toEqual(house())
  })

  it('is kept as it was by an editor that changes nothing', () => {
    expect(structureOfMap(mapOfStructure(house()))).toEqual(house())
  })

  // a structure resized in the editor and kept came back at the size its cells
  // fit, not the size it was kept at
  it('reopens at the size it was kept at', () => {
    const open = mapOfStructure(house())
    const wider = { ...open, extent: { q: open.extent.q + 4, r: open.extent.r + 2, s: open.extent.s + 3 } }
    expect(mapOfStructure(structureOfMap(wider)).extent).toEqual(wider.extent)
  })
})
