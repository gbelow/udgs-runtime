import type { CombatState } from '../types'
import { SPELLS, getSpellUpkeep, type SpellKey } from '../../spells'
import { getActiveSpellKeys } from '../../character/rules/effects'
import { getLinkDLOf, getLinkedTargets } from '../../character/rules/concentration'
import { getFightName } from '../rules/fighters'
import { getRepeatCost, getRepeatDraw } from '../rules/fireAgain'
import { getHeldEntry, getHeldSize } from '../../character/rules/concentration'
import { getChargeDraw } from '../../character/rules/spells'
import { perState } from './perState'

// spells.tex "Sustained Spells": what the active character is holding, what
// holding it costs at the round change, and who it links them to, with the
// DL those links put on every cast ("Telepathic Link").
export type SustainedRow = {
  key: SpellKey
  name: string
  // what holding it costs each round, null when nothing
  upkeep: string | null
  // what firing it again costs, null for one that cannot be
  repeat: string | null
  // the one target its arc is bound to, '' for none
  boundTo: string
  linked: { id: string; name: string }[]
  linkDL: number
}

function buildSustainedRows(state: CombatState): SustainedRow[] {
  const c = state.activeCharacterId ? state.characters[state.activeCharacterId] : undefined
  if (!c) return []
  return getActiveSpellKeys(c).map((key) => {
    const boundTo = getHeldEntry(c, key)?.boundTo
    const repeat = getRepeatCost(key)
    return {
      key,
      name: SPELLS[key].name,
      upkeep: upkeepLabel(getSpellUpkeep(SPELLS[key]), getChargeDraw(SPELLS[key].ammo, getHeldSize(c, key))),
      repeat: repeat ? upkeepLabel(repeat, getRepeatDraw(c, key)) : null,
      boundTo: boundTo ? getFightName(state, boundTo) : '',
      linked: getLinkedTargets(c, key).map((id) => ({ id, name: getFightName(state, id) })),
      linkDL: getLinkDLOf(c, key),
    }
  })
}

// The price as the panel prints it; a fraction of a charge is the chance
// to spend one more.
function upkeepLabel({ AP, STA }: { AP: number; STA: number }, charges: number): string | null {
  const parts = [AP ? `${AP}AP` : '', STA ? `${STA}STA` : '', charges ? `${Math.round(charges * 100) / 100} charge` : ''].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

export const getSustainedRows = perState(buildSustainedRows)

export const getSustainedDigest = perState((state) => JSON.stringify(getSustainedRows(state)))
