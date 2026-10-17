import type { SeenScene } from '../types'
import type { AfflictionKey } from '../../types'
import { perState } from '../../perState'
import { getAfflictions, isDead } from '../../character/rules/afflictions'
import { getSituationalAfflictions } from '../rules/situational'
import { CombatRosterEntry, getRosterParties } from './roster'

// A character as the middle of a fight with no board shows them: who they
// are to the open action, what they have left to spend, how hurt they are
// and what afflicts them now.
export type SceneCard = CombatRosterEntry & {
  isInTurn: boolean
  dead: boolean
  AP: number
  STA: number
  IL: number
  bleed: number
  burning: number
  conditions: AfflictionKey[]
}

export type SceneCardParty = { id: string; name: string; cards: SceneCard[] }

function buildSceneCards(state: SeenScene): SceneCardParty[] {
  return getRosterParties(state).map((party) => ({
    id: party.id,
    name: party.name,
    cards: party.entries.map((entry) => {
      const c = state.characters[entry.id]
      return {
        ...entry,
        isInTurn: entry.id === state.inTurnCharacter,
        dead: isDead(c),
        AP: c.resources.AP,
        STA: c.resources.STA,
        IL: c.injuries.injuryLevel,
        bleed: c.injuries.bleed,
        burning: c.injuries.burning,
        conditions: getAfflictions(c, getSituationalAfflictions(state, entry.id)),
      }
    }),
  }))
}

export const getSceneCards = perState(buildSceneCards)

// Everything the cards display, as one string, to gate their re-render; a
// card is freshly allocated on every call.
export const getSceneCardsDigest = perState((state: SeenScene) => JSON.stringify(getSceneCards(state)))
