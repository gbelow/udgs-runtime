import type { CampaignCharacter } from '../../types'
import type { Updater } from '../types'
import { getOpenAction } from '../rules/action'
import { settleGrapples } from './grapple'

// Takes a character out of the fight: their place on the board goes with
// them, and so does every grapple they were in. Refused while an action is
// open, since it may be theirs or aimed at them.
export function removeFromCombat(id: string): Updater {
  return (state) => {
    if (getOpenAction(state)) return state
    const { [id]: _, ...characters } = state.characters
    const { [id]: _placement, ...placements } = state.board?.placements ?? {}
    const left = { ...state, characters, board: state.board ? { ...state.board, placements } : null, grapples: state.grapples.filter((g) => !g.members.includes(id)) }
    return settleGrapples(state.grapples)(left)
  }
}

// Changes one character outside any action — an edit made on the sheet
// mid-fight — and brings the grapples back into line with it: a holder whose
// hands no longer hold a grapple row lets go.
export function updateCharacter(id: string, updater: (c: CampaignCharacter) => CampaignCharacter): Updater {
  return (state) => {
    const c = state.characters[id]
    if (!c) return state
    return settleGrapples(state.grapples)({ ...state, characters: { ...state.characters, [id]: updater(c) } })
  }
}
