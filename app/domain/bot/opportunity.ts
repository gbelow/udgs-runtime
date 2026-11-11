import type { CampaignCharacter } from '../types'
import type { ActionDraft, RootAction, SceneState } from '../scene/types'
import type { Dice } from '../play/dice'
import { amendReaction, declareReaction } from '../scene/commands/action'
import { isDeclarationComplete } from '../scene/rules/action'
import { getFreeAttackOptions, type AttackOption } from '../scene/rules/attack'
import { canAnswer, getLiveReactionsTo } from '../scene/rules/log'
import { getAvailableActions } from '../scene/rules/options'
import { getDefenseWorth, getReadings, getUnanswered } from './reading'
import { getLiveFoes, isMember, type Party } from './party'
import type { Played } from './move'

// combat.tex "Opportunity Attack": the opportunity attacks a bot may make on
// the action committed, and what each is worth: the exchange is played out
// with it and without it, the dice at a middling and at a high value
// (`settle`, everyone answering with defenses alone), and what it changes is
// read in fractions of the way to death: the wounds the foes carry less the
// party's, and what the character's own defenses are still worth against its
// foes (reading.ts). Most of what it is worth may be what it does to the
// action it answers: an attack of its own lands first, and its target may give
// that action up to defend. The rows tried are the two the quick reading says
// hit hardest unanswered. Whether to make one is the bot's to weigh.

export type Opportunity = { id: string; label: string; played: Played; worth: number }

export type Settle = (state: SceneState, dice: Dice) => SceneState

// combat.tex "Catch": a catch is declared as one.
const CATCHING = { catch: true, martialSpirit: false, tackle: false }

const DICE = [4, 9]
const ROWS_TRIED = 2

function reactionOf(state: SceneState, open: RootAction, id: string) {
  return getLiveReactionsTo(state, open.id).find((r) => r.actorId === id)
}

function fraction(c: CampaignCharacter | undefined): number {
  return c ? Math.min(1, c.injuries.injuryLevel / c.injuries.deathThreshold) : 0
}

function standing(state: SceneState, party: Party, id: string, foes: readonly string[]): number {
  const sum = (ids: readonly string[]) => ids.reduce((total, x) => total + fraction(state.characters[x]), 0)
  return sum(foes) - sum(party.members) + getDefenseWorth(state, [id], foes)
}

function outcome(from: SceneState, party: Party, id: string, settle: Settle): number {
  const foes = getLiveFoes(from, party)
  return DICE.reduce((sum, die) => sum + standing(settle(from, () => die), party, id, foes), 0) / DICE.length
}

// What answering the committed action as `answered` stands is worth to `id`
// and its party, against not answering: the same reckoning as an
// opportunity attack's, for setting a defense beside one.
export function getAnswerWorth(state: SceneState, party: Party, id: string, answered: SceneState, settle: Settle): number {
  return outcome(answered, party, id, settle) - outcome(state, party, id, settle)
}

export function getOpportunities(state: SceneState, party: Party, id: string, open: RootAction, newId: () => string, settle: Settle): Opportunity[] {
  const c = state.characters[id]
  if (!c || isMember(party, open.actorId) || !canAnswer(open, id) || reactionOf(state, open, id)) return []
  const options = getAvailableActions(state, id).filter((o) => o.available && o.draft.kind === 'opportunityAttack')
  if (options.length === 0) return []
  const without = outcome(state, party, id, settle)
  return options.flatMap((option): Opportunity[] => {
    const draft: ActionDraft = option.draft
    const declared = declareReaction(id, draft, newId)(state)
    const reaction = reactionOf(declared, open, id)
    const targetId = reaction && 'targetId' in reaction ? reaction.targetId : null
    if (!targetId || !state.characters[targetId]) return []
    const readings = getReadings(state, id, targetId, false)
    const hardest = (row: AttackOption) => {
      const r = readings.find((x) => x.kind === 'strike' && x.weaponKey === row.weaponKey && x.attack === row.attack && x.variant === row.variant)
      return r ? getUnanswered(r) : 0
    }
    const rows = getFreeAttackOptions(declared, declared.characters[id], 'strike')
      .flatMap((row) => {
        for (const extra of [{}, { modifiers: CATCHING }]) {
          const fields = { weaponKey: row.weaponKey, attack: row.attack, variant: row.variant, ...extra }
          const amended = amendReaction(id, fields)(declared)
          const r = reactionOf(amended, open, id)
          if (r && isDeclarationComplete(amended, amended.characters[id], r)) return [{ row, fields, amended }]
        }
        return []
      })
      .sort((x, y) => hardest(y.row) - hardest(x.row))
      .slice(0, ROWS_TRIED)
    const made = rows.map(({ row, fields, amended }): Opportunity => ({
      id,
      label: `opportunity attack ${row.weapon} ${row.attack} (${row.variant})`,
      played: { move: [{ kind: 'react', args: [id, draft] }, { kind: 'amendReaction', args: [id, fields] }], state: amended },
      worth: outcome(amended, party, id, settle) - without,
    }))
    const best = made.reduce<Opportunity | null>((x, y) => (!x || y.worth > x.worth ? y : x), null)
    return best ? [best] : []
  })
}

// The opportunity attack a bot would make without weighing it against the
// fight played on: the best any member of the party bar those named has, when
// the exchange comes out better with it than without.
export function bestOpportunity(state: SceneState, party: Party, open: RootAction, newId: () => string, settle: Settle, skip: readonly string[] = []): Opportunity | null {
  let best: Opportunity | null = null
  for (const id of party.members.filter((m) => !skip.includes(m))) {
    for (const o of getOpportunities(state, party, id, open, newId, settle)) if (o.worth > 0 && (!best || o.worth > best.worth)) best = o
  }
  return best
}
