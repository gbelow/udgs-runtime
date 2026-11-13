import type { SceneState } from '../scene/types'
import { isDead, getInjuryCapacity } from '../character/rules/afflictions'
import { getOpenAction } from '../scene/rules/log'
import { getAwaited } from '../scene/rules/options'
import { getTurnHolder } from '../scene/rules/turn'
import { getConcentrationOwed } from '../scene/rules/roundChange'
import { getButtonsOf, getSharedButtons, type OpenButton } from '../scene/projections/buttons'
import { getCommandActor } from '../scene/commands/registry'

// What a bot reads of the table besides the board: who is on which side, the
// buttons it may press, and what the table waits on it for. `members` are the
// characters its owner plays; `gm` whether that owner is the GM.

// combat.tex "Injuries and Death": dead, or collapsed at its injury capacity.
export function isDown(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !c || isDead(c) || c.injuries.injuryLevel >= getInjuryCapacity(c)
}

// `mine`: the members in the fight. `allies`: everyone else in the same party
// of the fight as one of them, whoever plays them. `foes`: everyone else still
// fighting. `down` and `surrendered` (combat.tex "Surrender") are out of both
// `allies` and `foes`, on whichever side they were.
export type Sides = { mine: string[]; allies: string[]; foes: string[]; down: string[]; surrendered: string[] }

const sidesKept = new WeakMap<SceneState, Map<string, Sides>>()

export function getSides(state: SceneState, members: readonly string[]): Sides {
  const byMembers = sidesKept.get(state) ?? new Map<string, Sides>()
  sidesKept.set(state, byMembers)
  const key = [...members].sort().join('\n')
  const known = byMembers.get(key)
  if (known) return known
  const parties = new Set(members.flatMap((m) => (state.partyOf[m] ? [state.partyOf[m]] : [])))
  const ids = Object.keys(state.characters)
  const out = (id: string) => isDown(state, id) || state.surrendered.includes(id)
  const made: Sides = {
    mine: ids.filter((id) => members.includes(id)),
    allies: ids.filter((id) => !members.includes(id) && parties.has(state.partyOf[id]) && !out(id)),
    foes: ids.filter((id) => !members.includes(id) && !parties.has(state.partyOf[id]) && !out(id)),
    down: ids.filter((id) => isDown(state, id)),
    surrendered: ids.filter((id) => state.surrendered.includes(id) && !isDown(state, id)),
  }
  byMembers.set(key, made)
  return made
}

// The open buttons (scene/projections/buttons.ts) that act for one of the
// members, or for the GM when the owner is the GM, or for anyone: each
// member's own, read for that member alone, and of the shared ones those
// whose actor is one of them.
export function getMyButtons(state: SceneState, members: readonly string[], gm = false): OpenButton[] {
  return [...members.flatMap((id) => getButtonsOf(state, id)), ...getSharedButtons(state).filter(({ command }) => {
    const actor = getCommandActor(state, command)
    if (actor === null) return true
    if (actor === 'gm') return gm
    if ('id' in actor) return members.includes(actor.id)
    return 'anyOf' in actor && actor.anyOf.some((id) => members.includes(id))
  })]
}

// What the table waits on a member for, so the bot is pinged: an answer to the
// action at `react` (`getAwaited`), a die it is called to throw, its own
// action still to be taken on (declared, or rolled and not landed), the turn it
// holds with nothing open, and at the round change, its concentration and a
// morale test it must make or settle.
export type Wait = { id: string; for: 'answer' | 'die' | 'action' | 'turn' | 'concentration' | 'morale' }

export function getWaits(state: SceneState, members: readonly string[]): Wait[] {
  const open = getOpenAction(state)
  const awaited = open?.step === 'react' ? getAwaited(state) : []
  const owed = getConcentrationOwed(state)
  const holder = getTurnHolder(state)
  return members.flatMap((id): Wait[] => {
    const morale = state.morale.find((m) => m.id === id)
    const waits: Wait['for'][] = [
      ...(awaited.includes(id) ? ['answer' as const] : []),
      ...(Object.values(state.calls).some((call) => call.roller === id) ? ['die' as const] : []),
      ...(open && open.actorId === id && (open.step === 'define' || open.step === 'post') ? ['action' as const] : []),
      ...(!open && holder === id ? ['turn' as const] : []),
      ...(owed.includes(id) ? ['concentration' as const] : []),
      ...(morale && ((morale.roll === null && !morale.optional) || morale.roll?.open) ? ['morale' as const] : []),
    ]
    return waits.map((why) => ({ id, for: why }))
  })
}
