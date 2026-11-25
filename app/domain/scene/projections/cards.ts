import type { SeenScene } from '../types'
import type { AfflictionKey, Third } from '../../types'
import { perState } from '../../perState'
import { SHOWN_IL_STEP } from '../../character/lenses/face'
import { getAfflictions, isDead } from '../../character/rules/afflictions'
import { getSituationalAfflictions } from '../rules/situational'
import { CombatRosterEntry, getRosterParties } from './roster'

// A character as the middle of a fight with no board shows them: who they
// are to the open action, what they have left to spend, how hurt they are
// and what afflicts them now.
export type SceneCard = CombatRosterEntry & {
  dead: boolean
  // a number on a sheet the viewer plays, a third left on a face
  AP: number | { third: Third }
  STA: number | { third: Third }
  // and how hurt, the number or, on a face, its tens, up to the collapse
  IL: number | { tens: number }
  bleed: number
  burning: number
  conditions: AfflictionKey[]
}

// the tens a face shows no further than: combat.tex "Injuries and Death" has them collapse at 50
const MOST_TENS = 5

export type SceneCardParty = { id: string; name: string; cards: SceneCard[] }

function buildSceneCards(state: SeenScene): SceneCardParty[] {
  return getRosterParties(state).map((party) => ({
    id: party.id,
    name: party.name,
    cards: party.entries.map((entry) => {
      const c = state.characters[entry.id]
      return {
        ...entry,
        dead: isDead(c),
        AP: c.shown ? { third: c.shown.AP } : c.resources.AP,
        STA: c.shown ? { third: c.shown.STA } : c.resources.STA,
        IL: c.shown ? { tens: Math.min(MOST_TENS, c.injuries.injuryLevel / SHOWN_IL_STEP) } : c.injuries.injuryLevel,
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
