import type { CampaignCharacter } from '../../types'
import type { Updater } from '../types'
import { getOpenAction } from '../rules/log'
import { isSpendingOutOfTurn } from '../rules/turn'
import { settleBinds } from './bind'
import { getChanges } from '../rules/changes'

// Takes a character out of the fight: their place on the board goes with
// them, and so does every grapple they were in. Refused while an action is
// open, since it may be theirs or aimed at them.
export function removeFromCombat(id: string): Updater {
  return (state) => {
    if (getOpenAction(state)) return state
    const { [id]: leaving, ...characters } = state.characters
    const { [id]: _placement, ...placements } = state.board?.placements ?? {}
    const left = { ...state, characters, names: leaving?.fightName ? { ...state.names, [id]: leaving.fightName } : state.names, inTurnCharacter: state.inTurnCharacter === id ? '' : state.inTurnCharacter, board: state.board ? { ...state.board, placements } : null, surrendered: state.surrendered.filter((s) => s !== id), binds: state.binds.filter((g) => !g.members.includes(id)) }
    return settleBinds(left)
  }
}

// Changes one character outside any action — an edit made on the sheet
// mid-fight — and brings the grapples back into line with it: a holder whose
// hands no longer hold a grapple row lets go.
export function updateCharacter(id: string, updater: (c: CampaignCharacter) => CampaignCharacter, cause = 'sheet edit'): Updater {
  return (state) => {
    const c = state.characters[id]
    if (!c) return state
    const after = settleBinds({ ...state, characters: { ...state.characters, [id]: updater(c) } })
    const changes = getChanges(state, after, 'edit')
    return changes.length === 0 ? after : { ...after, edits: [...after.edits, { cause, round: state.round, turn: state.turn, landed: state.record.length, changes }] }
  }
}

// A move with the character's gear — drawing, stowing, sliding a shield —
// refused when it would spend AP outside their own turn (play.tex "Combat").
export function updateInventory(id: string, updater: (c: CampaignCharacter) => CampaignCharacter): Updater {
  return (state) => {
    const c = state.characters[id]
    if (!c) return state
    const after = updater(c)
    return isSpendingOutOfTurn(state, c, after) ? state : updateCharacter(id, () => after, 'gear')(state)
  }
}
