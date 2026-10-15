import type { CampaignUpdater } from '../types'
import { makeName } from '../../instances'
import { without } from '../../utils'
import { getClockOf } from '../rules/clock'

// The name each of these characters goes by at the table follows their
// party: one on a timeline names them once, by `preferred` or their sheet's
// name, made apart from every name it has given; one outside time, or none,
// names nobody, so an encounter waiting to be played takes up no name.
export function nameByParty(ids: readonly string[], preferred?: string): CampaignUpdater {
  return (state) => ids.reduce((s, id) => {
    if (getClockOf(s, id) === null) return id in s.names ? { ...s, names: without(s.names, id) } : s
    const own = preferred || s.characters[id]?.name
    if (id in s.names || own === undefined) return s
    return { ...s, names: { ...s.names, [id]: makeName(own, Object.values(s.names)) } }
  }, state)
}
