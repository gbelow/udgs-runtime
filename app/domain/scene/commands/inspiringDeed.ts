import type { SceneState, Updater } from '../types'
import type { AttitudeHappening } from '../../character/rules/attitudes'
import { payCost } from '../../character/commands/cost'
import { getLeadershipRallyBar, isInspiring } from '../rules/providence'
import { getSpeakingRound } from '../rules/roundChange'
import { getSocialCost } from '../rules/social'
import { isCombatStarted } from '../rules/started'
import { updateCharacter } from './characters'
import { rally } from './social'

// abilities.tex "Inspiring Deed": "Rallies their team any time they roll a 9
// on the dice", for free. A rally says the same value to the same hearers,
// so once in the round is as good as every time (the table's ruling).
export function inspire(state: SceneState, id: string, happened: AttitudeHappening[]): SceneState {
  if (!isInspiring(state, id, happened)) return state
  const round = getSpeakingRound(state)
  return state.pressure.some((p) => p.from === id && p.kind === 'rally' && p.round === round) ? state : rally(state, id)
}

// abilities.tex "Leadership": the holder rallies once everyone has rolled
// their morale test, for the price of a rally. The bonus it lends is for the
// round that begins (`resumeTurns`).
export function leadershipRally(id: string): Updater {
  return (state) => {
    const c = state.characters[id]
    if (!c || getLeadershipRallyBar(state, id)) return state
    const paid = updateCharacter(id, payCost(getSocialCost(c, 'rally'), isCombatStarted(state)), 'Leadership')(state)
    return rally({ ...paid, moraleRallies: [...paid.moraleRallies, id] }, id)
  }
}
