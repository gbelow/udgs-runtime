import { isCombatStarted } from '../rules/started'
import type { CampaignCharacter, Delivery } from '../../types'
import { deliver } from '../../character/commands/deliver'
import type { SceneState, Updater } from '../types'
import { getOpenAction } from '../rules/log'
import { getHeldActions } from '../rules/hold'
import { withdrawActions } from './log'
import { getGearBar } from '../rules/turn'
import { settleBinds } from './bind'
import { dropEmptyFightParties } from './parties'
import { getChanges } from '../rules/changes'
import { without } from '../../utils'
import { getChaseWithoutDead } from '../rules/chase'
import { isDead } from '../../character/rules/afflictions'

// Takes a character out of the fight: their place on the board and in their
// party goes with them, and so does every grapple they were in and the cover
// they had taken.
// Refused while an action is open, since it may be theirs or aimed at them.
export function removeFromCombat(id: string): Updater {
  return (given) => {
    if (getOpenAction(given)) return given
    const state = withdrawActions(given, getHeldActions(given).filter((h) => h.actorId === id).map((h) => h.id), 'failed')
    const { [id]: _placement, ...placements } = state.board?.placements ?? {}
    const { [id]: _cover, ...bodyCover } = state.bodyCover
    const { [id]: _party, ...partyOf } = state.partyOf
    const left = dropEmptyFightParties({ ...state, characters: without(state.characters, id), partyOf, inTurnCharacter: state.inTurnCharacter === id ? '' : state.inTurnCharacter, board: state.board ? { ...state.board, placements } : null, surrendered: state.surrendered.filter((s) => s !== id), bodyCover, binds: state.binds.filter((g) => !g.members.includes(id)) }, [state.partyOf[id]])
    return settleBinds(left)
  }
}

// The dead leave their party and the turns where they fell, and stay in the
// fight as characters: the sheet, the token and the gear are theirs still, to
// be looted (`pickUp`), and they are not given back with the party when the
// fight ends (`leaveBehind`). Done as soon as nothing is being played out,
// since nobody leaves a party mid-action.
export function layToRest(state: SceneState): SceneState {
  const dead = Object.values(state.characters).filter((c) => isDead(c) && c.id in state.partyOf)
  if (getOpenAction(state) || dead.length === 0) return state
  // a party with nobody left alive is out of the chase before it is gone from the fight
  const chased = state.chase ? { ...state, chase: getChaseWithoutDead(state, state.chase) } : state
  return dead.reduce((given, c) => {
    const s = withdrawActions(given, getHeldActions(given).filter((h) => h.actorId === c.id).map((h) => h.id), 'failed')
    const { [c.id]: _party, ...partyOf } = s.partyOf
    const left = dropEmptyFightParties({ ...s, partyOf, inTurnCharacter: s.inTurnCharacter === c.id ? '' : s.inTurnCharacter, surrendered: s.surrendered.filter((id) => id !== c.id), binds: s.binds.filter((g) => !g.members.includes(c.id)) }, [s.partyOf[c.id]])
    return settleBinds(left)
  }, chased)
}

// Changes one character outside any action — an edit made on the sheet
// mid-fight — and brings the grapples back into line with it: a holder whose
// hands no longer hold a grapple row lets go. The updater is told whether
// the combat has started, the one place its prices are paid.
export function updateCharacter(id: string, updater: (c: CampaignCharacter, charged: boolean) => CampaignCharacter, cause = 'sheet edit'): Updater {
  return (state) => {
    const c = state.characters[id]
    if (!c) return state
    const after = settleBinds({ ...state, characters: { ...state.characters, [id]: updater(c, isCombatStarted(state)) } })
    const changes = getChanges(state, after, 'edit')
    const noted = changes.length === 0 ? after : { ...after, edits: [...after.edits, { cause, round: state.round, turn: state.turn, landed: state.landed.length, changes }] }
    return layToRest(noted)
  }
}

// The GM lays a delivery on each of the characters: a test they are owed to
// roll and the effect that rides on it, or an effect that lands at once. Each
// waits on their own die (`resolvePending`). Refused while an action is open,
// since it may be theirs or aimed at them.
export function impose(ids: string[], delivery: Delivery): Updater {
  return (state) => (getOpenAction(state) ? state : ids.reduce((acc, id) => updateCharacter(id, deliver(delivery), 'GM called a test')(acc), state))
}

// A move with the character's gear — drawing, stowing, donning, sliding a
// shield — refused outside their own turn once the fight has started
// (play.tex "Combat"). The GM moves anyone's gear at any time, and the log
// keeps it as the GM's edit.
export function updateInventory(id: string, updater: (c: CampaignCharacter, charged: boolean) => CampaignCharacter, gm = false): Updater {
  return (state) => {
    if (!state.characters[id]) return state
    if (getGearBar(state, id, gm)) return state
    return updateCharacter(id, updater, gm ? 'GM edit' : 'gear')(state)
  }
}
