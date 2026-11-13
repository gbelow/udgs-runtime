import type { SceneState } from '../scene/types'
import { getFightName } from '../scene/rules/fighters'
import type { SeatInput } from './decision'

// What a seat is offered is read off the fight itself (bot/seat.ts), so it
// must name nobody the seat does not see (multiplayer-plan.md "Hidden
// information"): no id of theirs in what its buttons and choices press, and
// no name of theirs in their labels. Who the seat sees is whoever is in the
// fight as it sees it (`view`). A name a seen character bears too is not
// counted, as it tells nothing.

export type Everyone = { id: string; name: string }[]

export function getEveryone(state: SceneState): Everyone {
  return Object.keys(state.characters).map((id) => ({ id, name: getFightName(state, id) }))
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function getPanelLeaks(input: Pick<SeatInput, 'view' | 'buttons' | 'choices'>, everyone: Everyone): string[] {
  const seen = input.view().characters
  const hidden = everyone.filter((c) => !seen[c.id])
  if (hidden.length === 0) return []
  const seenNames = new Set(everyone.filter((c) => seen[c.id]).map((c) => c.name))
  const offers = [...input.buttons, ...input.choices]
  return offers.flatMap((offer) => {
    const pressed = JSON.stringify(offer.command)
    return hidden.flatMap((c) => {
      const named = !seenNames.has(c.name) && new RegExp(`(^|\\W)${escape(c.name)}(\\W|$)`).test(offer.label)
      return pressed.includes(c.id) || named ? [`"${offer.label}" names ${c.name}, whom the seat does not see`] : []
    })
  })
}
