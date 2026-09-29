import type { CombatState } from '../types'
import { SPELLS, getSpellUpkeep, type SpellKey } from '../../spells'
import { getActiveSpellKeys } from '../../character/rules/effects'
import { getLinkDLOf, getLinkedTargets } from '../../character/rules/concentration'
import { getFightName } from '../rules/fighters'
import { perState } from './perState'

// spells.tex "Sustained Spells": what the active character is holding, what
// holding it costs at the round change, and who it links them to, with the
// DL those links put on every cast ("Telepathic Link").
export type SustainedRow = {
  key: SpellKey
  name: string
  // what holding it costs each round, null when nothing
  upkeep: string | null
  linked: { id: string; name: string }[]
  linkDL: number
}

function buildSustainedRows(state: CombatState): SustainedRow[] {
  const c = state.activeCharacterId ? state.characters[state.activeCharacterId] : undefined
  if (!c) return []
  return getActiveSpellKeys(c).map((key) => ({
    key,
    name: SPELLS[key].name,
    upkeep: upkeepLabel(getSpellUpkeep(SPELLS[key])),
    linked: getLinkedTargets(c, key).map((id) => ({ id, name: getFightName(state, id) })),
    linkDL: getLinkDLOf(c, key),
  }))
}

function upkeepLabel({ AP, STA }: { AP: number; STA: number }): string | null {
  const parts = [AP ? `${AP}AP` : '', STA ? `${STA}STA` : ''].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

export const getSustainedRows = perState(buildSustainedRows)

export const getSustainedDigest = perState((state) => JSON.stringify(getSustainedRows(state)))
