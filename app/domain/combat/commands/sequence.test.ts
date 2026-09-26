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
import { getOwnCost, isDeclarationComplete } from '../rules/action'
import { amendAction, amendReaction, commitAction, declareAction, declareReaction, payAction, resolveAction, rollAction, setTarget, withdrawReaction } from './action'
import { aimPush } from './choices'
import { withdrawSpawnedAction } from './action'
import { produceEffects } from '../../character/rules/production'
import { SPELLS } from '../../spells'

function fighter(id: string, abilities: string[] = []): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, fightName: id, abilities, resources: { ...base.resources, AP: 12, STA: 6 } }
}

function archer(id: string): CampaignCharacter {
  const bow = ItemSchema.parse({ name: 'Short Bow', type: 'weapon', refId: 'Short Bow', bulk: 2 })
  return { ...(regripItem(bow.id, 2)(holdItem(bow)(fighter(id))) as CampaignCharacter), usedSurge: 'focus' }
}

function spearman(id: string, abilities: string[] = []): CampaignCharacter {
  const spear = ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })
  return regripItem(spear.id, 2)(holdItem(spear)(fighter(id, abilities))) as CampaignCharacter
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

// The actions the opportunity attacks declared in `s` opened, among `landed`.
function openedByOpportunity(s: CombatState, landed: Action[]): Action[] {
  const declared = s.actions.filter((a) => a.kind === 'opportunityAttack').map((a) => a.id)
  return landed.filter((a) => a.spawnedBy !== null && declared.includes(a.spawnedBy))
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
    for (const id of next.history.slice(s.history.length)) landed.push(next.actions.find((a) => a.id === id)!)
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

// A has grabbed B and pushes them 2m straight at a spearman with reach 2,
// B going along only passively; the push lands and its way is walked, the
// spearman answering it (combat.tex "Push and drag"; "Opportunity Attack":
// "moving towards a melee weapon while within its attack range").
function pushTowardsSpearman(): CombatState {
  let s = onBoard({ a: [0, 0], b: [1, 0], t: [4, 0] }, fighter('a'), fighter('b'), spearman('t'))
  s = declareAction('a', { kind: 'strike', grab: true, weaponKey: 'natural:Unarmed', attack: 'grapple', variant: 'basic' }, newId)(s)
  s = resolveAction(newId)(rollAction(() => 50, newId)(commitAction()(setTarget('b')(s))))
  s = declareAction('a', { kind: 'drag' }, newId)(s)
  s = payAction(newId)(commitAction()(setTarget('b')(s)))
  s = resolveAction(newId)(aimPush({ choice: 'push', direction: 0, steps: 2 })(s))
  expect(getOpenAction(s)?.kind).toBe('displace')
  return everyoneAttacks(s, ['t'])
}

const scenarios = [
  { name: 'a shot', start: shotBetweenThreateners, reactors: ['t1', 't2'] },
  { name: 'a move', start: walkPastSpearmen, reactors: ['r1', 'r2'] },
  { name: 'a flanked strike', start: strikeFlankedTwice, reactors: ['f1', 'f2'] },
  { name: 'a push', start: pushTowardsSpearman, reactors: ['t'] },
]

describe.each(scenarios)('the opportunity attacks drawn by $name', ({ start, reactors }) => {
  // The table's ruling: every declared reaction resolves. On a miss nothing
  // is interrupted and nothing cuts the action short.
  it('are each fought, once', () => {
    const s = start()
    const declared = s.actions.filter((a) => a.kind === 'opportunityAttack')
    expect(declared.map((a) => a.actorId).sort()).toEqual([...reactors].sort())
    const { landed } = playOut(s, MISS)
    expect(openedByOpportunity(s, landed).map((a) => a.spawnedBy).sort()).toEqual(declared.map((a) => a.id).sort())
  })

  // combat.tex "Opportunity Attack": "The attack occurs before the effect of
  // the triggering action."
  it('land before the action that drew them', () => {
    const s = start()
    const rootId = getOpenAction(s)!.id
    const { landed } = playOut(s, MISS)
    expect(landed.at(-1)?.id).toBe(rootId)
    expect(openedByOpportunity(s, landed)).toHaveLength(reactors.length)
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
    expect(openedByOpportunity(s, landed)).toHaveLength(2)
    expect(state.characters.def).toEqual(s.characters.def)
  })

  // The table's ruling: only the pusher being interrupted stops a push; one
  // who is dragged and interrupted is still dragged all the way.
  it('does not stop a push when the one it interrupts is dragged', () => {
    const { state } = playOut(pushTowardsSpearman(), LAND)
    expect(state.actions.find((a) => a.kind === 'strike' && a.targetId === 'b' && a.step === 'done' && a.interruption !== 'none')).toBeDefined()
    expect(state.board?.placements.b?.cell).toEqual({ q: 3, r: 0 })
    expect(state.board?.placements.a?.cell).toEqual({ q: 2, r: 0 })
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

// combat.tex "Opportunity Attack": "It is possible to cancel the triggering
// action and reuse the AP spent to defend against an opportunity attack."
// The table's ruling: the AP is not refunded but pays towards the first
// defense, the one against the attack the action was given up for; later
// defenses pay in full.
describe('giving up the action an opportunity attack answers', () => {
  // The shot between two threateners, rolled to land on its target, with the
  // shooter stood before the first attack it drew; the attacks will miss.
  function firstAttackOnShooter(): CombatState {
    const s = rollAction(() => LAND, newId)(shotBetweenThreateners())
    expect(getOpenAction(s)?.targetId).toBe('atk')
    return s
  }
  const evade = (s: CombatState) => declareReaction('atk', { kind: 'evade' }, newId)(s)
  const evadeOf = (s: CombatState, id: string) => s.actions.find((a) => a.kind === 'evade' && a.reactionTo === id)

  it('happens by defending actively, and the shot then lands nothing', () => {
    const s = firstAttackOnShooter()
    const { state } = playOut(evade(s), MISS)
    expect(state.characters.def).toEqual(s.characters.def)
  })

  it("pays the shot's AP towards the first defense only", () => {
    let s = evade(firstAttackOnShooter())
    const shot = s.actions.find((a) => a.kind === 'shoot')!
    const first = getOpenAction(s)!
    s = resolveAction(newId)(rollAction(() => MISS, newId)(s))
    const second = getOpenAction(s)!
    s = rollAction(() => MISS, newId)(evade(s))
    const full = evadeOf(s, second.id)!.cost!.AP
    expect(evadeOf(s, first.id)!.cost!.AP).toBe(Math.max(0, full - shot.cost!.AP))
  })

  it("is taken back with the defense, before that attack's die", () => {
    const s = firstAttackOnShooter()
    const kept = withdrawReaction('atk')(evade(s))
    const { state } = playOut(kept, MISS)
    expect(state.characters.def).not.toEqual(s.characters.def)
  })
})

// The table's ruling: an explosion's area picks its targets after the
// reactions have moved, never before (combat.tex "Explosions": "People react
// with reflexes to leave the area").
describe('an explosion', () => {
  // A grenade charged with a shock explosive (radius 3) thrown between two
  // who stand beside its centre, both clearing the reflex.
  function grenadeAtTwo(): CombatState {
    const base = fighter('t')
    const grenade = ItemSchema.parse({ name: 'Grenade', type: 'weapon', refId: 'Grenade', bulk: 1 })
    const charged = { ...grenade, charge: { key: 'shock-explosive', effects: produceEffects(base, SPELLS['shock-explosive'].effects) } }
    const thrower = { ...(holdItem(charged)(base) as CampaignCharacter), usedSurge: 'focus' as const }
    let s = onBoard({ t: [-5, 0], x: [0, -1], y: [0, 1] }, thrower, fighter('x'), fighter('y'))
    const [row] = getAttackOptions(s.characters.t, 'explosion')
    s = declareAction('t', { kind: 'explosion', source: 'thrown', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(s)
    s = commitAction()(amendAction({ center: { q: 0, r: 0 } })(s))
    for (const id of ['x', 'y']) s = declareReaction(id, { kind: 'avoidExplosion' }, newId)(s)
    return rollAction(() => 50, newId)(s)
  }

  // One walks 3m out of it, the other skips the escape.
  it('reaches only who is still in the area once the escapes are walked', () => {
    let s = grenadeAtTwo()
    const escaping = () => getOpenAction(s)!.actorId
    for (let i = 0; i < 5 && getOpenAction(s)?.kind === 'move'; i++) {
      s = escaping() === 'x'
        ? resolveAction(newId)(payAction(newId)(commitAction()(amendAction({ movement: 'basic', path: [{ q: 0, r: -2 }, { q: 0, r: -3 }, { q: 0, r: -4 }] })(s))))
        : withdrawSpawnedAction(newId)(s)
    }
    expect(getOpenAction(s)?.kind).toBe('blast')
    const blast = resolveAction(newId)(s).actions.find((a) => a.kind === 'blast')
    const facts = blast?.kind === 'blast' ? blast.facts ?? {} : {}
    expect(facts.x).toBeUndefined()
    expect(facts.y?.length).toBeGreaterThan(0)
  })
})

// A spearman's thrust at the character, committed.
function thrustAt(target: CampaignCharacter): CombatState {
  let s = onBoard({ atk: [0, 0], [target.id]: [1, 0] }, spearman('atk'), target)
  const [row] = getAttackOptions(s.characters.atk, 'strike')
  s = declareAction('atk', { kind: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(s)
  return commitAction()(setTarget(target.id)(s))
}

// abilities.tex "Counterattack": "Both attacks are made against the
// opponent's SD. The attack with the higher result hits first, having the
// chance to interrupt the opponent. The counterattack receives -2 to hit."
// The table's ruling: on a tie both land, neither interrupting the other.
describe('a counterattack', () => {
  // The dice are the thrust's, then the counterattack's; every hit here
  // interrupts. Who struck, in the order they landed, and whether it hit.
  function landings(faces: number[]): { by: string; hit: boolean }[] {
    const def = spearman('def', ['counterattack'])
    let s = declareReaction('def', { kind: 'counterattack' }, newId)(thrustAt(def))
    const [row] = getAttackOptions(s.characters.def, 'strike')
    s = amendReaction('def', { weaponKey: row.weaponKey, attack: row.attack, variant: row.variant })(s)
    const dice = [...faces]
    s = rollAction(() => dice.shift()!, newId)(s)
    for (let i = 0; i < 5 && getOpenAction(s); i++) s = resolveAction(newId)(s)
    return s.history.map((id) => s.actions.find((a) => a.id === id)!).map((a) => ({ by: a.actorId, hit: a.kind === 'strike' && a.facts !== null }))
  }

  it('that rolls higher lands first, and the attack it interrupts lands nothing', () => {
    expect(landings([3, 9])).toEqual([{ by: 'def', hit: true }, { by: 'atk', hit: false }])
  })

  it('that rolls lower is broken by the attack that interrupts it', () => {
    expect(landings([9, 5])).toEqual([{ by: 'atk', hit: true }])
  })

  // 7 less the counterattack's 2 is the thrust's 5
  it('that rolls the same lands along with the attack', () => {
    expect(landings([5, 7])).toEqual([{ by: 'def', hit: true }, { by: 'atk', hit: true }])
  })
})

// abilities.tex "Riposte": "After defending a melee attack that misses, the
// character can make an attack with a +2 bonus to hit immediately after. The
// attack costs 1 AP less than the normal attack, and 2 AP less if made with
// an object different from the one used for defense."
describe('a riposte', () => {
  // A thrust that misses a shield-bearer who knows Riposte, blocking with
  // the shield or standing on their SD.
  function missedShieldBearer(block: boolean): CombatState {
    const shield = ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 2 })
    let s = thrustAt(holdItem(shield)(fighter('def', ['riposte'])) as CampaignCharacter)
    const option = getAvailableActions(s, 'def').find((o) => o.draft.kind === 'block' && o.draft.weaponKey === shield.id)!
    if (block) s = declareReaction('def', option.draft, newId)(s)
    return resolveAction(newId)(rollAction(() => MISS, newId)(s))
  }

  it('is offered to one who defended actively, at the attacker', () => {
    const open = getOpenAction(missedShieldBearer(true))
    expect(open).toMatchObject({ kind: 'strike', actorId: 'def', targetId: 'atk', step: 'define' })
  })

  it('is not offered to one who stood on their SD', () => {
    expect(getOpenAction(missedShieldBearer(false))).toBeNull()
  })

  it('costs 1 AP less with the object that defended, 2 with another', () => {
    const s = missedShieldBearer(true)
    const shield = s.characters.def.held[0].id
    const discounts = getAttackOptions(s.characters.def, 'strike').filter((o) => o.variant === 'basic').map((o) => {
      const declared = amendAction({ weaponKey: o.weaponKey, attack: o.attack, variant: o.variant })(s)
      return { same: o.weaponKey === shield, less: o.AP - getOwnCost(declared, getOpenAction(declared)!)!.AP }
    })
    expect(discounts.filter((d) => d.same).map((d) => d.less)).toEqual([1])
    expect(new Set(discounts.filter((d) => !d.same).map((d) => d.less))).toEqual(new Set([2]))
  })
})
