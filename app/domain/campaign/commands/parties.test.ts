import { describe, it, expect } from 'vitest'
import { CampaignStateSchema } from '../types'
import { addMap, updateCampaignMap } from './parties'
import { removeNode } from './map'
import map from '../../../assets/maps/Map 1.json'

// The user's ruling: a node of a campaign's map is not taken away while a
// party stands on it, and nothing else keeps a node.
describe('removing a node of a campaign map', () => {
  const withMap = addMap('m', map)(CampaignStateSchema.parse({}))
  const nodes = Object.keys(withMap.maps.m.nodes)

  it.each(nodes)('is refused while a party is on %s, and allowed with nobody there', (node) => {
    const occupied = { ...withMap, parties: CampaignStateSchema.parse({ parties: { p: { at: { map: 'm', node } } } }).parties }
    expect(updateCampaignMap('m', removeNode(node))(occupied)).toBe(occupied)
    expect(updateCampaignMap('m', removeNode(node))(withMap).maps.m.nodes[node]).toBeUndefined()
  })
})
