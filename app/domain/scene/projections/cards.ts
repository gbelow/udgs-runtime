import type { SeenScene } from '../types'
import type { AfflictionKey } from '../../types'
import { perState } from '../../perState'
import { getGauges, type Gauges } from '../../character/lenses/bars'
import { getAfflictions, isDead } from '../../character/rules/afflictions'
import { getSituationalAfflictions } from '../rules/situational'
import { CombatRosterEntry, getRosterParties } from './roster'

// A character as the middle of a fight with no board shows them: who they
// are to the open action, what they have left to spend, how hurt they are
// and what afflicts them now.
export type SceneCard = CombatRosterEntry & {
  dead: boolean
  // what they have left and how hurt they are: the numbers on a sheet the
  // viewer plays, none on a face, and as a face shows them, for their gauges
  AP: number | null
  STA: number | null
  IL: number | null
  gauges: Gauges
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
        dead: isDead(c),
        AP: c.shown ? null : c.resources.AP,
        STA: c.shown ? null : c.resources.STA,
        IL: c.shown ? null : c.injuries.injuryLevel,
        gauges: getGauges(c),
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

// Whose side a face is on for the screen: an ally of whoever it looks from
// (the character picked, else the characters it plays), or an enemy.
export type FaceSide = 'ally' | 'enemy'
export type FaceCard = SceneCard & { side: FaceSide }
export type FaceParty = { id: string; name: string; cards: FaceCard[] }

export function getFaceParties(state: SeenScene, own: readonly string[]): FaceParty[] {
  const from = state.activeCharacterId ? [state.activeCharacterId] : own
  const parties = new Set(from.flatMap((id) => (state.partyOf[id] === undefined ? [] : [state.partyOf[id]])))
  const sideOf = (id: string): FaceSide => (from.includes(id) || (state.partyOf[id] !== undefined && parties.has(state.partyOf[id])) ? 'ally' : 'enemy')
  return getSceneCards(state).map((p) => ({ ...p, cards: p.cards.map((c) => ({ ...c, side: sideOf(c.id) })) }))
}
