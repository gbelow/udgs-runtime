import type { ActionDraft, SceneState } from '../scene/types'
import { getAvailableActions } from '../scene/rules/options'
import { getActionDef } from '../scene/rules/actionCatalog'
import { getRoundPhase } from '../scene/rules/roundChange'
import { getPressingFactors, getSocialValue } from '../scene/rules/morale'
import { getRecoveredSTA, getSTARegen } from '../character/rules/characteristics'
import { MORALE_TRIGGER, ROUND_AP } from '../tables'
import { getDanger, getSpendPrice, getSTAPrice, getTeam, THREAT_TUNING, type ThreatTuning } from './threat'

// What a character does with the round's rest step, for any box (the user's
// ruling, 2026-11-15): the AP left when the round ends is lost, and a social
// action is a rest that does something besides (combat.tex "Social actions":
// "Every social action costs 5 AP and counts as a Rest action"), so it is
// worth the STA the rest gives back, dearer the less the character has, and
// what is said, more for more Charisma; less the AP it overdraws from the
// round to come, dearer the more threatened the character is. With nobody to
// say it to, a plain rest. What is said: an intimidation, or a rally first
// when someone of the team faces a morale test (its aggravating factors at
// MORALE_TRIGGER) or the box puts rallies first (`rallyFirst`); whichever the
// team has not said as strongly this round (the user's ruling). Nothing here
// presses.

export type RestTuning = ThreatTuning & {
  // what what is said is worth, for every point of its value (`getSocialValue`)
  restSay: number
  // above 0, a rally is said before an intimidation (a personality)
  rallyFirst: number
}

export const REST_TUNING: RestTuning = { ...THREAT_TUNING, restSay: 2, rallyFirst: 0 }

export type RestChoice = { draft: ActionDraft; worth: number; why: string }

// Whether the character may rest or say something now: the round's rest
// step, and something that counts as a rest open to it.
export function canRestNow(state: SceneState, id: string): boolean {
  return getRoundPhase(state) === 'rest' && getAvailableActions(state, id).some((o) => o.available && getActionDef(o.draft.kind).rest)
}

export function getRestChoice(view: SceneState, members: readonly string[], id: string, tuning: RestTuning): RestChoice | null {
  const c = view.characters[id]
  if (!c || getRoundPhase(view) !== 'rest') return null
  const offered = getAvailableActions(view, id).filter((o) => o.available && getActionDef(o.draft.kind).rest)
  const allies = getTeam(view, members).filter((t) => t !== id)
  // combat.tex "Social actions": "Multiple intimidations and taunts don't
  // stack. Only the highest one counts", nor rallies: what the character has
  // said already this round adds nothing, nor what someone of the team has
  // said as strongly. In order, the first that adds something; with nothing
  // left to say, a plain rest (the user's ruling)
  const team = new Set([id, ...allies])
  const saidThisRound = Object.values(view.actions).filter((a) => a.kind === 'social' && a.round === view.round && team.has(a.actorId))
  const spokeAlready = saidThisRound.some((a) => a.actorId === id)
  const rallyFirst = tuning.rallyFirst > 0 || allies.some((t) => getPressingFactors(view, t) >= MORALE_TRIGGER)
  const order = rallyFirst ? (['rally', 'intimidate'] as const) : (['intimidate', 'rally'] as const)
  const say = spokeAlready ? null : order.find((kind) => !saidThisRound.some((a) => a.kind === 'social' && a.say === kind && getSocialValue(view.characters[a.actorId] ?? c, kind) >= getSocialValue(c, kind))) ?? null
  const mine = say ? getSocialValue(c, say) : 0
  const spoken = say ? offered.find((o) => o.draft.kind === 'social' && 'say' in o.draft && o.draft.say === say) : undefined
  const rest = offered.find((o) => o.draft.kind === 'rest')
  const STA = c.resources.STA
  const back = getRecoveredSTA(c, STA, getSTARegen(c)) - STA
  const STAworth = getSTAPrice(back, STA + back, 0, tuning)
  const danger = getDanger(view, members, id, 'potential', undefined, undefined, tuning)
  // at the rest step the coming round's AP are handed out already, kept above
  // the round's until the step is over (scene/commands/nextRound.ts): what the
  // rest takes from that round is what it leaves it short of the round's AP,
  // priced as any spend is, by the worst foe's potential threat on the character
  const overdraw = (AP: number) => getSpendPrice({ AP: ROUND_AP - Math.min(ROUND_AP, c.resources.AP - AP), STA: 0 }, STA, c.injuries.bleed, danger, tuning)
  const choices = [
    ...(spoken?.cost ? [{ draft: spoken.draft, worth: STAworth + tuning.restSay * mine - overdraw(spoken.cost.AP), why: say }] : []),
    ...(rest?.cost ? [{ draft: rest.draft, worth: STAworth - overdraw(rest.cost.AP), why: 'rest' }] : []),
  ]
  const best = choices.reduce<(typeof choices)[number] | null>((b, x) => (!b || x.worth > b.worth ? x : b), null)
  return best && best.worth > 0 ? { draft: best.draft, worth: best.worth, why: `${best.why} at the round's rest (worth ${best.worth.toFixed(1)}: ${back} STA back)` } : null
}
