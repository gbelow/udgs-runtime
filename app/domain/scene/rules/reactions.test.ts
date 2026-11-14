import { describe, it, expect } from 'vitest'
import { SceneStateSchema, type ActionOf, type SceneState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema, type CampaignCharacter } from '../../types'
import { holdItem, regripItem } from '../../item/commands/hands'
import { getOpenAction } from './log'
import { getTriggers } from './reactions'
import { getOpportunityState } from './opportunity'
import { getMeleeDistance, getMeleeRange } from './board/board'
import { amendAction, commitAction, declareAction as declareOwnAction, declareReaction } from '../commands/action'

// Each action below is declared in its actor's own turn (play.tex "Combat").
const declareAction = (...[actorId, draft, newId]: Parameters<typeof declareOwnAction>) => (s: SceneState) =>
  declareOwnAction(actorId, draft, newId)({ ...s, inTurnCharacter: actorId })

function fighter(id: string, AP: number, STA = 6): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, resources: { ...base.resources, AP, STA } }
}

// A spearman (reach 2) stood four cells from a mover who walks straight at
// him, three cells, and the move committed.
function approach(reactorAP: number, reactorSTA = 6): SceneState {
  const spear = ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })
  const r = regripItem(spear.id, 2)(holdItem(spear)(fighter('r', reactorAP, reactorSTA)))
  let n = 0
  let s: SceneState = {
    ...SceneStateSchema.parse({ round: 1, board: { placements: { m: { cell: { q: 0, r: 0 } }, r: { cell: { q: 4, r: 0 } } } } }),
    characters: { m: fighter('m', 12), r },
  }
  s = declareAction('m', { kind: 'move' }, () => `a${++n}`)(s)
  s = amendAction({ movement: 'walk', path: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }] })(s)
  return commitAction(() => 5, () => 'x')(s)
}

describe('opportunity attack against a mover', () => {
  // Fired on the step that brought the mover into range, one step early.
  // combat.tex "Opportunity Attack": "moving towards a melee weapon while
  // within its attack range" — the mover is at distance 2 after step 2 and
  // steps closer, within reach, on step 3.
  it('fires on the step taken within range, not the step that entered it', () => {
    const s = approach(8)
    const trigger = getTriggers(s, getOpenAction(s)!).find((t) => t.kind === 'opportunityAttack')
    expect(trigger?.at).toBe(3)
  })

  // Was offered to a reactor with no AP for the strike it opens, who then
  // had no way back short of cancelling the whole move. combat.tex
  // "Opportunity Attack": "The attack requires the normal AP cost".
  it('is closed to a reactor who cannot pay for a strike', () => {
    expect(getOpenAction(approach(0, 0))).toBeNull()
  })

  // combat.tex "Action surge": the reaction surge is made outside one's own
  // turn, so a reactor with no AP but 3 STA may surge and then strike.
  it('is open to a reactor with no AP who can make a reaction surge', () => {
    const s = declareReaction('r', { kind: 'opportunityAttack', at: 3 }, () => 'o1')(approach(0))
    expect(s.characters.r.usedSurge).toBe('reaction')
  })

  // An ogre two cells long, its move ending turned about, walked through a
  // reactor with a short weapon: the attack fired with the ogre in reach, but
  // was fought from a step further back, out of reach, because the step it was
  // fought from was read with the ogre already turned to its end orientation
  // (and so on the reactor's space), not as the move's preview has it.
  it('is fought where the preview has a turning mover of several cells', () => {
    let n = 0
    const ogre = { ...fighter('m', 12), footprint: [{ q: 0, r: 0 }, { q: -1, r: 0 }] }
    let s: SceneState = {
      ...SceneStateSchema.parse({ round: 1, board: { placements: { m: { cell: { q: 0, r: 0 } }, r: { cell: { q: 4, r: 0 } } } } }),
      characters: { m: ogre, r: fighter('r', 8) },
    }
    s = declareAction('m', { kind: 'move' }, () => `a${++n}`)(s)
    s = amendAction({ movement: 'walk', path: [1, 2, 3, 4, 5].map((q) => ({ q, r: 0 })), orientation: 3 })(s)
    s = commitAction(() => 5, () => 'x')(s)
    const trigger = getTriggers(s, getOpenAction(s)!).find((t) => t.kind === 'opportunityAttack' && t.characterId === 'r')!
    s = declareReaction('r', { kind: 'opportunityAttack', at: trigger.at }, () => `o${++n}`)(s)
    const attack = Object.values(s.actions).find((a): a is ActionOf<'opportunityAttack'> => a.kind === 'opportunityAttack')!
    const fought = getOpportunityState(s, attack)
    expect(getMeleeDistance(fought, 'r', 'm')).toBeLessThanOrEqual(getMeleeRange(s.characters.r))
  })
})
