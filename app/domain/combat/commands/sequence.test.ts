import { describe, it, expect } from 'vitest'
import { CombatStateSchema, type Action, type CombatState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema, type CampaignCharacter } from '../../types'
import { holdItem, regripItem } from '../../item/commands/hands'
import { getAvailableActions } from '../rules/options'
import { getLiveReactionsTo, getOpenAction } from '../rules/log'
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
// actions landed.
function playOut(start: CombatState, face: number): { state: CombatState; landed: Action[] } {
  let s = start
  const landed: Action[] = []
  for (let i = 0; i < 50; i++) {
    const open = getOpenAction(s)
    if (!open) return { state: s, landed }
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

const scenarios = [
  { name: 'a shot', start: shotBetweenThreateners, reactors: ['t1', 't2'] },
  { name: 'a move', start: walkPastSpearmen, reactors: ['r1', 'r2'] },
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
})

// combat.tex "Interruption": "interrupts any action from its victim". The
// table's ruling: every declared opportunity attack is still fought after
// one has broken the action, and the broken action lands nothing.
describe('an action broken by an opportunity attack', () => {
  it('lands nothing, and every attack it drew is still fought', () => {
    const s = shotBetweenThreateners()
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
