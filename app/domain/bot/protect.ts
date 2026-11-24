import type { SurgeKind } from '../types'
import type { ActionDraft, SceneState, StrikeAction, ShootAction } from '../scene/types'
import { appendActions } from '../scene/commands/log'
import { makeAction } from '../scene/factories'
import { getCombinedOf, getStepLandings, isCombinedDefense } from '../scene/rules/combinedMove'
import { placeAt, withPlacements } from '../scene/rules/board/board'
import { getSurgeAP, getSurgeSTA, isLearnedSurge } from '../character/rules/surge'
import { getLiveActions, getOpenAction, getReactionsTo, withLiveActions } from '../scene/rules/log'
import { getRootTest } from '../scene/rules/attack'
import { getAvailableActions } from '../scene/rules/options'
import { declare, type Pick } from './declare'
import { getBleed, getHarm, harmAt, type PairAttack, type PairDefence } from './pairs'
import { getKnownAttack, TRIAL } from './moves'

// The defences a character could make for an ally attacked (combat.tex
// "Protect", "Guard"), each read as a defence of the ally's own: the attack's
// hits are what they do to the ally, its graze and its miss as the table lands
// them with the defence declared, its DL moved by what the defence adds to the
// one the table gives the attack answered with none. Nothing here decides.

const GUARDING = new Set<ActionDraft['kind']>(['block', 'intercept', 'guard'])

// The fight with the move `id`'s defence carries before its die made
// (abilities.tex "Defender", "Protection Surge"), where the table reads the
// defence from; the fight as it is where it carries none, null where the move
// has nowhere to end.
function stepped(state: SceneState, root: StrikeAction | ShootAction, id: string): SceneState | null {
  const defense = getReactionsTo(state, root.id).find((r) => r.actorId === id && isCombinedDefense(r))
  const entry = defense ? getCombinedOf(state.characters[id], defense) : null
  if (!defense || !isCombinedDefense(defense) || entry?.recipe.order !== 'before') return state
  const from = state.board?.placements[id]
  const to = getStepLandings(state, root, defense, entry)[0]
  if (!from || !to) return null
  return appendActions(withPlacements(state, { [id]: placeAt(state.board, from, to) }), [makeAction('move', { id: 'guard-step', actorId: id, spawnedBy: defense.id, step: 'done' })])
}

// Whoever defends the target of `root` with one, or the target defending itself.
export const getDefenders = (view: SceneState, root: StrikeAction | ShootAction): string[] =>
  getReactionsTo(view, root.id).filter((r) => r.actorId === root.targetId || GUARDING.has(r.kind)).map((r) => r.actorId)

// `AP`: what the defence costs the character in all, the combat surge's where
// it is made with a surge of its own, which takes the round's. `surge`: that surge.
export type Protection = { draft: ActionDraft; picks: Pick[]; AP: number; surge: SurgeKind | null; defence: PairDefence }

// The attack open on someone else as `id` would meet it for them: `attack`
// answered with none or with what `protections` offers. `fill` picks what an
// answer still asks for once declared. One only a surge with a press of its
// own opens is left out, and one a learned surge opens costs its STA, its AP
// paid by it. Null with no attack open on someone else, or one that cannot be
// read.
export function getProtections(view: SceneState, id: string, fill: (draft: ActionDraft) => Pick[] | null): { attack: PairAttack; gap: number; protections: Protection[] } | null {
  const root = getOpenAction(view)
  const me = view.characters[id]
  if (!root || !me || (root.kind !== 'strike' && root.kind !== 'shoot') || !root.targetId || root.targetId === id) return null
  const ally = view.characters[root.targetId]
  const known = getKnownAttack(view, root, root.targetId)
  const none = known?.attack.defences.find((d) => d.draft === null)
  const bare = getRootTest(withLiveActions(view, getLiveActions(view).filter((a) => a.reactionTo !== root.id)), root)
  if (!ally || !known || !none || !bare) return null
  const protections = getAvailableActions(view, id).flatMap((o): Protection[] => {
    if (!o.available || o.reactionTo !== root.id || !GUARDING.has(o.draft.kind) || !o.cost || (o.surge !== null && !isLearnedSurge(o.surge))) return []
    const picks = fill(o.draft)
    const made = picks ? declare(view, { actorId: id, option: o.draft, picks }, TRIAL) : null
    const open = made?.ok ? getOpenAction(made.ready) : null
    if (!picks || !made?.ok || !open || (open.kind !== 'strike' && open.kind !== 'shoot')) return []
    const at = stepped(made.ready, open, id)
    const test = at && getRootTest(at, open)
    if (!at || !test) return []
    const cost = o.surge === null ? o.cost : { AP: Math.max(0, o.cost.AP - getSurgeAP(o.surge)(me)), STA: o.cost.STA + getSurgeSTA(o.surge)(me) }
    return [{
      draft: o.draft,
      picks,
      AP: o.surge === null ? o.cost.AP : getSurgeAP('combat')(me),
      surge: o.surge,
      defence: {
        draft: o.draft,
        cost,
        DL: none.DL + test.DL - bare.DL,
        graze: harmAt(at, open, 'graze', ally, getHarm),
        miss: harmAt(at, open, 'miss', ally, getHarm),
        bleeds: { ...none.bleeds, graze: harmAt(at, open, 'graze', ally, getBleed), miss: harmAt(at, open, 'miss', ally, getBleed) },
      },
    }]
  })
  return { attack: { ...known.attack, defences: [none, ...protections.map((p) => p.defence)] }, gap: known.gap, protections }
}
