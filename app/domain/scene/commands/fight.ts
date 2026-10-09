import type { CampaignState } from '../../campaign/types'
import type { TableUpdater } from '../types'
import { withInstance } from '../../instances'
import { leaveFight } from '../../character/commands/leaveFight'
import { resetCombat } from './resetCombat'
import { getReturnBar } from '../rules/fight'
import { addToRoster, checkOut } from '../../campaign/commands/roster'
import { dropEmptyParties } from '../../campaign/commands/parties'
import { passETs } from '../../campaign/commands/clock'

// Takes these characters off the roster and into the fight.
export function sendToFight(ids: string[], newId: () => string): TableUpdater {
  return (table) => ids.reduce(({ campaign, fight }, id) => {
    const c = campaign.characters[id]
    if (!c) return { campaign, fight }
    return { campaign: checkOut(id)(campaign), fight: { ...fight, characters: withInstance(c, fight.characters, newId) } }
  }, table)
}

// Whoever was sent to a fight and did not come back from it leaves their
// party.
function forgetMissing(state: CampaignState): CampaignState {
  const gone = state.out.filter((id) => !state.characters[id])
  if (gone.length === 0) return state
  const partyOf = Object.fromEntries(Object.entries(state.partyOf).filter(([id]) => !gone.includes(id)))
  return dropEmptyParties({ ...state, partyOf, out: state.out.filter((id) => !gone.includes(id)) })
}

// Ends the fight and puts everyone in it back on the roster as the fight left
// them — whoever joined the fight on its own joins the roster too. A fight
// that ran rounds leaves its marks on them. The clock moves on by the ETs the
// table says the scene took, if any.
export function returnFromFight(ets: number, newId: () => string): TableUpdater {
  return (table) => {
    if (getReturnBar(table.fight)) return table
    const { campaign, fight } = table
    const left = Object.values(fight.characters).map((c) => (fight.round > 0 ? leaveFight(c) : c))
    const back = forgetMissing(left.reduce((state, c) => addToRoster(c, newId)(state), campaign))
    return { campaign: passETs(ets)(back), fight: resetCombat(fight) }
  }
}
