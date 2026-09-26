import { describe, it, expect } from 'vitest'
import { CombatStateSchema, type Action, type CombatState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema, type CampaignCharacter } from '../../types'
import { holdItem, regripItem } from '../../item/commands/hands'
import { getAvailableActions } from '../rules/options'
import { getLiveReactionsTo, getOpenAction, getOpeningReaction } from '../rules/log'
import { getTriggers } from '../rules/reactions'
import { getLastReport } from '../projections/outcomes'
import { getAttackOptions } from '../rules/attack'
import { isDeclarationComplete } from '../rules/action'
import { amendAction, amendReaction, commitAction, declareAction, declareReaction, payAction, resolveAction, rollAction, setTarget } from './action'

function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, fightName: id, resources: { ...base.resources, AP: 12, STA: 6 } }
}

function archer(id: string): CampaignCharacter {
  const bow = ItemSchema.parse({ name: 'Short Bow', type: 'weapon', refId: 'Short Bow', bulk: 2 })
  return { ...(regripItem(bow.id, 2)(holdItem(bow)(fighter(id))) as CampaignCharacter), usedSurge: 'focus' }
}

function spearman(id: string): CampaignCharacter {
  const spear = ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })
  return regripItem(spear.id, 2)(holdItem(spear)(fighter(id))) as CampaignCharacter
}

function onBoard(placements: Record<string, [number, number]>, ...characters: CampaignCharacter[]): CombatState {
  const cells = Object.fromEntries(Object.entries(placements).map(([id, [q, r]]) => [id, { cell: { q, r } }]))
  return { ...CombatStateSchema.parse({ board: { placements: cells } }), characters: Object.fromEntries(characters.map((c) => [c.id, c])) }
}

let n = 0
const newId = () => `a${++n}`

// Every threatener the open action triggers declares the opportunity attack
// the list offers them, with the first strike they hold that completes it.
function everyoneAttacks(s: CombatState, reactorIds: string[]): CombatState {
  return reactorIds.reduce((state, id) => {
    const option = getAvailableActions(state, id).find((o) => o.draft.kind === 'opportunityAttack' && o.available)
    if (!option) return state
    const declared = declareReaction(id, option.draft, newId)(state)
    const rootId = getOpenAction(declared)!.id
    for (const { weaponKey, attack, variant } of getAttackOptions(declared.characters[id], 'strike')) {
      const amended = amendReaction(id, { weaponKey, attack, variant })(declared)
      const reaction = getLiveReactionsTo(amended, rootId).find((r) => r.actorId === id)
      if (reaction && isDeclarationComplete(amended, amended.characters[id], reaction)) return amended
    }
    return declared
  }, s)
}

function isRoot(a: Action): boolean {
  return a.reactionTo === null
}

// Plays the open action out to the end with the die showing `face`, taking
// every default a step offers, and returns the order in which its root
// actions landed, and the triggers each action an opportunity attack opened
// offered while it was open to answers.
function playOut(start: CombatState, face: number): { state: CombatState; landed: Action[]; openedTriggers: string[] } {
  let s = start
  const landed: Action[] = []
  const openedTriggers: string[] = []
  for (let i = 0; i < 50; i++) {
    const open = getOpenAction(s)
    if (!open) return { state: s, landed, openedTriggers }
    if (open.step === 'react' && getOpeningReaction(s, open)) openedTriggers.push(...getTriggers(s, open).map((t) => t.kind))
    const next = [rollAction(() => face, newId), payAction(newId), resolveAction(newId)].map((step) => step(s)).find((t) => t !== s)
    if (!next) throw new Error(`stuck on ${open.kind} (${open.step})`)
    for (const a of next.actions.filter(isRoot)) {
      const was = s.actions.find((b) => b.id === a.id)
      if (a.step === 'done' && was?.step !== 'done') landed.push(a)
    }
    s = next
  }
  throw new Error('did not end')
}

// A shot at a target three cells away, from between two threateners
// (combat.tex "Opportunity Attack": "ranged attacks" are triggering actions).
function shotBetweenThreateners(): CombatState {
  let s = onBoard({ atk: [0, 0], def: [-3, 0], t1: [0, 1], t2: [1, -1] }, archer('atk'), fighter('def'), spearman('t1'), spearman('t2'))
  s = declareAction('atk', { kind: 'shoot', weaponKey: s.characters.atk.held[0].id, attack: 'shoot', variant: 'basic' }, newId)(s)
  s = commitAction()(setTarget('def')(s))
  return everyoneAttacks(s, ['t1', 't2'])
}

// A walk of three cells straight at two spearmen with reach 2, stood side by
// side, the move committed (combat.tex "Opportunity Attack": "moving towards
// a melee weapon while within its attack range").
function walkPastSpearmen(): CombatState {
  let s = onBoard({ m: [0, 0], r1: [4, 0], r2: [4, -1] }, fighter('m'), spearman('r1'), spearman('r2'))
  s = declareAction('m', { kind: 'move' }, newId)(s)
  s = commitAction()(amendAction({ movement: 'basic', path: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }] })(s))
  return everyoneAttacks(s, ['r1', 'r2'])
}

// A die of 1 misses everything; a die of 5 has every spear land with an
// interruption.
const MISS = 1
const LAND = 5

// A punch at a defender, with two spearmen lined up behind the attacker
// (combat.tex "Flanking": an attack triggers an opportunity attack from those
// "that cannot be fit within a semi-circle centered on the triggering
// attack's target"). The nearer spearman's attack on the attacker has the
// farther one behind it in turn.
function strikeFlankedTwice(): CombatState {
  let s = onBoard({ atk: [0, 0], def: [1, 0], f1: [-1, 0], f2: [-2, 0] }, fighter('atk'), fighter('def'), spearman('f1'), spearman('f2'))
  s = declareAction('atk', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)(s)
  s = commitAction()(setTarget('def')(s))
  return everyoneAttacks(s, ['f1', 'f2'])
}

const scenarios = [
  { name: 'a shot', start: shotBetweenThreateners, reactors: ['t1', 't2'] },
  { name: 'a move', start: walkPastSpearmen, reactors: ['r1', 'r2'] },
  { name: 'a flanked strike', start: strikeFlankedTwice, reactors: ['f1', 'f2'] },
]

describe.each(scenarios)('the opportunity attacks drawn by $name', ({ start, reactors }) => {
  // The table's ruling: every declared reaction resolves. On a miss nothing
  // is interrupted and nothing cuts the action short.
  it('are each fought, once', () => {
    const s = start()
    const declared = s.actions.filter((a) => a.kind === 'opportunityAttack')
    expect(declared.map((a) => a.actorId).sort()).toEqual([...reactors].sort())
    const { landed } = playOut(s, MISS)
    const opened = landed.filter((a) => a.spawnedBy !== null)
    expect(opened.map((a) => a.spawnedBy).sort()).toEqual(declared.map((a) => a.id).sort())
  })

  // combat.tex "Opportunity Attack": "The attack occurs before the effect of
  // the triggering action."
  it('land before the action that drew them', () => {
    const s = start()
    const rootId = getOpenAction(s)!.id
    const { landed } = playOut(s, MISS)
    expect(landed.at(-1)?.id).toBe(rootId)
    expect(landed.filter((a) => a.spawnedBy !== null)).toHaveLength(reactors.length)
  })

  // The table's ruling: opportunity attacks never trigger other opportunity
  // attacks. What one opens is still defended against.
  it('draw no opportunity attacks of their own', () => {
    const { openedTriggers } = playOut(start(), MISS)
    expect(openedTriggers.length).toBeGreaterThan(0)
    expect(openedTriggers).not.toContain('opportunityAttack')
  })
})

// combat.tex "Interruption": "interrupts any action from its victim". The
// table's ruling: every declared opportunity attack is still fought after
// one has broken the action, and the broken action lands nothing.
describe('an action broken by an opportunity attack', () => {
  it.each([
    { name: 'a shot', start: shotBetweenThreateners },
    { name: 'a flanked strike', start: strikeFlankedTwice },
  ])('$name lands nothing, and every attack it drew is still fought', ({ start }) => {
    const s = start()
    const { state, landed } = playOut(s, LAND)
    expect(landed.filter((a) => a.spawnedBy !== null)).toHaveLength(2)
    expect(state.characters.def).toEqual(s.characters.def)
  })

  // The table's ruling: an interrupted mover stays one step short of the
  // stretch the attack fired on, and walks no further.
  it('leaves a mover where the attack caught them', () => {
    const { state } = playOut(walkPastSpearmen(), LAND)
    expect(state.board?.placements.m?.cell).toEqual({ q: 2, r: 0 })
  })
})

// The report after a strike its flanker interrupted showed the flanker's
// thrust, not the strike: the last action in the log was taken for the last
// one to land, and the strike, declared first, was never reported cancelled.
it('reports the strike a flanker broke as cancelled once it closes', () => {
  const { state } = playOut(strikeFlankedTwice(), LAND)
  const report = getLastReport(state)
  expect(report?.actor).toBe('atk')
  expect(report?.outcomes).toEqual([])
  expect(report?.notes.map((n) => n.text)).toContain('strike cancelled')
})
