import type { CampaignCharacter } from '../types'
import { ActionSchema, SceneStateSchema, type ActionDraft, type AttackAction, type SceneState, type StrikeAction } from '../scene/types'
import type { ActionCost } from '../character/rules/actionCosts'
import type { Outcome } from '../character/rules/damage'
import type { RollMode } from '../play/dice'
import { appendActions } from '../scene/commands/log'
import { getDefaultAim, getFreeAttackOptions, getRootTest, hasUnfocusedRow } from '../scene/rules/attack'
import { getAvailableActions } from '../scene/rules/options'
import { getOwnCost } from '../scene/rules/action'
import { getStrikeReach } from '../scene/rules/board/board'
import { findWeaponRow } from '../scene/rules/weaponRow'
import { getAttackFacts, outcomeOf } from '../scene/rules/damage'
import { isVariantOpen, isVariantOpenOn } from '../scene/rules/strikeDeclaration'
import { getHOPPrice } from '../scene/rules/damage'
import { getHeavyDegrees } from '../scene/rules/heavy'
import { getLoadableAmmo } from '../item/rules/ammo'
import { getSTA } from '../character/rules/characteristics'
import { getInjuryPenalty } from '../character/rules/afflictions'
import { getTestMode, mayRollRisky } from '../character/rules/effects'
import { ROUND_AP } from '../tables'
import { getBestSpend } from './predict'
import { getMostHOP, type HarmByDegree } from './odds'

// What one character's attacks do to another, each against each defence the
// other could answer with, read off the table's own rules: the attack and
// its answer are made as records and put beside the two, both at a fresh
// round's AP and full STA, with no board and nobody else, and each degree it
// could come to is read off the damage rules as the landing reads them (a
// hit's HOP spent by `getBestSpend`). Nothing is pressed.
// Where they stand plays no part (no cover, no high ground, no light), and a
// shot's distance penalty is left to the reader (`distanceRate`), so the table
// holds for any two places. Harm is 2 x IL + 3 x bleed (the user's ruling).
//
// A hit lands in full whatever the defence (combat.tex "Defend"), so a hit's
// harm is read once, undefended, but for a hook attack's, whose bonus turns on
// the defence; a graze and a miss are read against each defence.

export type PairDefence = {
  // the reaction answered with as the panel offers it, or null for none (the SD)
  draft: ActionDraft | null
  cost: ActionCost
  DL: number
  graze: number
  miss: number
  // harm on a hit at each HOP from 0 against this defence, where it differs
  // from the attack's own (a hook attack's bonus against an evasive jump)
  hits?: number[]
}

export type PairAttack = {
  kind: 'strike' | 'shoot'
  row: { weaponKey: string; attack: string; variant: string }
  // the stack a shot is loaded from, each one an attack of its own (a bodkin
  // and a broadhead do different things); '' for a strike or a row that
  // loads nothing
  ammoId: string
  // the heavy degree a strike is made at (combat.tex "Heavy Attack"), each
  // degree the row allows an attack of its own; 0 for none, and
  // `declaresHeavy` when the degree is above the row's own and so is
  // declared besides the row
  heavy: number
  declaresHeavy: boolean
  // where the variation may be made (scene/rules/strikeDeclaration.ts
  // `isVariantOpenOn`): as an action of its own, as the opportunity attack a
  // step towards the weapon draws (a braced attack), or the one a runner
  // moving away draws (a hook attack)
  opens: { action: boolean; approach: boolean; retreat: boolean }
  // what is declared, and, for a braced or a hook attack, what its bonus
  // costs on a hit besides (`onHit`); `cost` holds both, so that the attack
  // is weighed as made in full
  onHit: ActionCost | null
  cost: ActionCost
  // metres
  reach: number
  // the penalty a shot takes per step of distance (`getDistancePenalty`); null for a strike
  distanceRate: number | null
  // whether the row is open only once the focus surge is made
  needsFocus: boolean
  skill: number
  grazes: boolean
  // the way the attacker throws the test now (`getTestMode`), and every way
  // it may (risky only where an ability lets it, play.tex "Safe and risky
  // tests"; an attack is never thrown safely)
  mode: RollMode
  modes: RollMode[]
  // harm on a hit at each HOP from 0
  hits: number[]
  defences: PairDefence[]
}

export const getHarm = (o: Outcome | null | undefined): number => (o ? 2 * o.IL + 3 * o.bleed : 0)

const fresh = (c: CampaignCharacter): CampaignCharacter => ({ ...c, usedSurge: null, resources: { ...c.resources, AP: ROUND_AP, STA: getSTA(c) } })

// The two, and nothing else: the fight begun, so that what they do is priced.
function between(attacker: CampaignCharacter, defender: CampaignCharacter): SceneState {
  return SceneStateSchema.parse({ round: 1, characters: { [attacker.id]: attacker, [defender.id]: defender }, parties: { a: {}, d: {} }, partyOf: { [attacker.id]: 'a', [defender.id]: 'd' } })
}

const ATTACK_ID = 'pair-attack'
const ANSWER_ID = 'pair-answer'

// The attack as though its die had come up so, nothing bought.
function rolled(root: AttackAction, degree: 'miss' | 'graze' | 'hit', HOP = 0): AttackAction {
  return { ...root, step: 'post', spent: {}, roll: { die: 0, DL: 0, score: degree === 'hit' ? 5 + HOP : degree === 'graze' ? 0 : -1, degree, HOP, skillTerms: [], DLTerms: [] } }
}

// What the attack does to the defender at a graze or a miss against the
// defence it was answered with, as the landing reads it.
function harmAt(state: SceneState, root: AttackAction, degree: 'miss' | 'graze', defender: CampaignCharacter): number {
  const facts = getAttackFacts(state, rolled(root, degree))
  return facts ? getHarm(outcomeOf(facts, defender)) : 0
}

// The attacks one character's rows make on another, declared as records
// (as `declareAction` and `declareReaction` make them) and put in a fight of
// the two by the one writer of actions (`appendActions`), the attack waiting
// on its answer; the answers are those the table offers the defender
// (`getAvailableActions`). Nothing is pressed.
function readPair(attacker: CampaignCharacter, defender: CampaignCharacter): PairAttack[] {
  const a = attacker.id
  const d = defender.id
  const ready = fresh(attacker)
  const focused: CampaignCharacter = { ...ready, usedSurge: 'focus' }
  const target = fresh(defender)
  const unfocused = between(ready, target)
  const open = new Set(getFreeAttackOptions(unfocused, ready, 'shoot').map((o) => `${o.weaponKey}/${o.attack}/${o.variant}`))
  const attacks: PairAttack[] = []
  for (const kind of ['strike', 'shoot'] as const) {
    const actor = kind === 'shoot' && hasUnfocusedRow(ready, 'shoot', true) ? focused : ready
    const base = between(actor, target)
    for (const option of getFreeAttackOptions(base, actor, kind)) {
      const row = { weaponKey: option.weaponKey, attack: option.attack, variant: option.variant }
      const found = findWeaponRow(actor, option.weaponKey, option.attack)
      const loads = kind === 'shoot' && found?.atk.ammo ? getLoadableAmmo(actor, found.weapon, found.atk).map((s) => s.item.id) : ['']
      const range = kind === 'strike' ? getHeavyDegrees(actor, row) : null
      const degrees = range ? Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i) : [0]
      for (const ammoId of loads) for (const heavy of degrees) {
        const root = ActionSchema.parse({ kind, id: ATTACK_ID, actorId: a, targetId: d, ...row, ...(ammoId ? { ammoId } : {}), ...(kind === 'strike' ? { heavy } : {}), ...getDefaultAim(target), step: 'react' }) as AttackAction
        const made = appendActions(base, [root])
        const opens = kind === 'strike'
          ? { action: isVariantOpen(made, root, row), approach: isVariantOpenOn({ braced: true, hooked: false }, row.variant), retreat: isVariantOpenOn({ braced: false, hooked: true }, row.variant) }
          : { action: isVariantOpen(made, root, row), approach: false, retreat: false }
        if (!opens.action && !opens.approach && !opens.retreat) continue
        const test = getRootTest(made, root)
        const declared = getOwnCost(made, root)
        if (!test || test.scale !== 'overflow' || !declared) continue
        // a braced attack is only ever drawn by a step towards the weapon, so
        // its bonus is read as bought (no step draws it here); a hook
        // attack's is bought where it adds something (`getBestSpend`)
        const bonus = row.variant === 'braced' || row.variant === 'hook' ? row.variant : null
        const onHit = bonus ? getHOPPrice(bonus, actor) : null
        const cost = onHit ? { AP: declared.AP + onHit.AP, STA: declared.STA + onHit.STA } : declared
        const reach = kind === 'strike' ? getStrikeReach(made, root as StrikeAction) : option.reach
        if (reach === null) continue

        const answers = getAvailableActions(made, d).filter((o) => o.available && o.reactionTo === root.id && !o.surge)
        const defended: { draft: ActionDraft | null; state: SceneState; cost: ActionCost }[] = [{ draft: null, state: made, cost: { AP: 0, STA: 0 } }, ...answers.flatMap((o) => {
          const reaction = ActionSchema.parse({ ...o.draft, id: ANSWER_ID, actorId: d, targetId: a, reactionTo: root.id, recipe: o.draft.recipe ?? null })
          const given = appendActions(made, [reaction])
          const price = getOwnCost(given, reaction)
          return price ? [{ draft: o.draft, state: given, cost: price }] : []
        })]
        const hit = (state: SceneState, HOP: number) => {
          const at = rolled(root, 'hit', HOP)
          return getHarm(getBestSpend(state, bonus === 'braced' ? { ...at, spent: { braced: 1 } } : at).outcome)
        }
        const tested = defended.flatMap((def) => {
          const t = getRootTest(def.state, root)
          return t ? [{ def, t }] : []
        })
        const most = getMostHOP(test.skill, Math.min(...tested.map((x) => x.t.DL)))
        const hitsIn = (state: SceneState) => Array.from({ length: Math.max(0, most + 1) }, (_, HOP) => hit(state, HOP))
        const hits = hitsIn(made)
        // a hook attack's bonus turns on how the target answers (combat.tex
        // "Hook Attack": against an evasive jump), so its hits are read again
        // against each defence
        const defences = tested.map(({ def, t }): PairDefence => {
          const own = bonus === 'hook' && def.draft ? hitsIn(def.state) : null
          return { draft: def.draft, cost: def.cost, DL: t.DL, graze: harmAt(def.state, root, 'graze', target), miss: harmAt(def.state, root, 'miss', target), ...(own && own.some((h, i) => h !== hits[i]) ? { hits: own } : {}) }
        })
        attacks.push({
          kind,
          row,
          ammoId,
          heavy,
          declaresHeavy: range !== null && heavy > range.min,
          opens,
          onHit,
          cost,
          reach,
          distanceRate: kind === 'shoot' ? option.distance : null,
          needsFocus: kind === 'shoot' && !open.has(`${row.weaponKey}/${row.attack}/${row.variant}`),
          skill: test.skill,
          grazes: test.grazes,
          mode: getTestMode(attacker),
          modes: mayRollRisky(attacker) ? ['normal', 'risky'] : ['normal'],
          hits,
          defences,
        })
      }
    }
  }
  return attacks
}

// A sheet as the pair table reads it: who it is and what changes on every
// press (AP, STA, the surge made, the face's thirds) left out, and its injury
// level read as the penalty it gives (combat.tex "Injury level (IL)"), which
// is all of it an attack or a defence reads, so the table is read again only
// when something it rests on changes, and two copies of one sheet share it.
const signatures = new WeakMap<CampaignCharacter, string>()

function signature(c: CampaignCharacter): string {
  let sig = signatures.get(c)
  if (sig === undefined) {
    const { id, resources, usedSurge, shown, injuries, ...rest } = c
    void id
    void usedSurge
    void shown
    sig = JSON.stringify({ ...rest, resources: { ...resources, AP: 0, STA: 0 }, injuries: { ...injuries, injuryLevel: getInjuryPenalty(c) } })
    signatures.set(c, sig)
  }
  return sig
}

const pairs = new Map<string, PairAttack[]>()
const MOST_KEPT = 4000

export function getPair(attacker: CampaignCharacter, defender: CampaignCharacter): PairAttack[] {
  const key = `${signature(attacker)}\n${signature(defender)}`
  let known = pairs.get(key)
  if (!known) {
    if (pairs.size >= MOST_KEPT) pairs.clear()
    known = readPair(attacker, defender)
    pairs.set(key, known)
  }
  return known
}

export const harmOf = (attack: PairAttack, defence: PairDefence): HarmByDegree => ({ miss: defence.miss, graze: defence.graze, hits: defence.hits ?? attack.hits })
