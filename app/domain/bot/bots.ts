import type { SceneState } from '../scene/types'
import { getControllerId } from '../scene/rules/domination'
import { isBot, type BotId } from '../profiles'
import type { Box } from './decision'
import type { Seat } from './seat'
import { nearestBox } from './boxes/nearest'
import { THREAT_WEIGHTS, threatBox } from './boxes/threat'
import { SPEC_WEIGHTS, specBox } from './boxes/spec'

// The decision box each bot plays with.
export const BOT_BOXES: Record<BotId, Box> = {
  'bot:threat': threatBox(THREAT_WEIGHTS),
  'bot:spec': specBox(SPEC_WEIGHTS),
  'bot:nearest': nearestBox,
}

// The seats the bots play in a fight: one for each bot and party in it, of
// the characters that bot plays (`ownerOf`, which already gives a dominated
// character to whoever plays the one dominating them), so that two parties
// given to the same bot play against each other and neither knows the other's
// sheets. A dominated character sits with the party of the one dominating it.
export function getBotSeats(state: SceneState, ownerOf: (id: string) => string | undefined): Seat[] {
  const seats = new Map<string, Seat & { members: string[] }>()
  for (const id of Object.keys(state.characters)) {
    const bot = ownerOf(id)
    if (bot === undefined || !isBot(bot)) continue
    const party = state.partyOf[getControllerId(state, id)] ?? ''
    const seatId = `${bot}/${party}`
    const seat = seats.get(seatId) ?? { id: seatId, profile: bot, box: BOT_BOXES[bot], members: [] }
    seat.members.push(id)
    seats.set(seatId, seat)
  }
  return [...seats.values()]
}
