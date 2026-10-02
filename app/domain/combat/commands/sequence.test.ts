import { describe, it, expect } from 'vitest'
import { CombatStateSchema, type Action, type CombatState, type Coord } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema, type CampaignCharacter } from '../../types'
import { holdItem, regripItem } from '../../item/commands/hands'
import { addItemToContainer } from '../../item/commands/items'
import { putOnFromCatalog } from '../../item/commands/containers'
import { getCatalogItem } from '../../item/rules/items'
import { getAvailableActions } from '../rules/options'
import { getLiveReactionsTo, getOpenAction, getOpeningReaction } from '../rules/log'
import { getTriggers } from '../rules/reactions'
import { getLastReport } from '../projections/outcomes'
import { getOptionLabel } from '../projections/labels'
import { getAttackOptions, getDLTerms, getDefendingReaction } from '../rules/attack'
import { getOwnCost, isDeclarationComplete } from '../rules/action'
import { amendAction, amendReaction, commitAction, declareAction as declareOwnAction, declareReaction, payAction, resolveAction, rollAction, setTarget, withdrawReaction } from './action'
import { aimExplosion, spendHOP } from './choices'
import { pickCell } from './board'
import { withdrawSpawnedAction } from './action'
import { endTurn } from './turn'
import { produceEffects } from '../../character/rules/production'
import { SPELLS } from '../../spells'
import { getTethers } from '../rules/partners'
import { getSpellOptions } from '../rules/cast'

// Each action below is declared in its actor's own turn (play.tex "Combat").
const declareAction = (...[actorId, draft, newId]: Parameters<typeof declareOwnAction>) => (s: CombatState) =>
  declareOwnAction(actorId, draft, newId)({ ...s, inTurnCharacter: actorId })

function fighter(id: string, abilities: string[] = []): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, fightName: id, abilities, resources: { ...base.resources, AP: 12, STA: 6 } }
}

// A shooter with a bow in both hands, the focus surge spent (combat.tex
// "Focus surge": "required to use ranged attacks") and a quiver of arrows
// slung on the belt (gear.tex "Quiver").
function archer(id: string): CampaignCharacter {
  const bow = ItemSchema.parse({ name: 'Short Bow', type: 'weapon', refId: 'Short Bow', bulk: 2 })
  const arrows = ItemSchema.parse({ id: 'arrows', name: 'Broadhead Arrow', type: 'ammo', refId: 'Broadhead Arrow', bulk: 0, amount: 20 })
  const quiver = getCatalogItem('Quiver')!
  const belted = putOnFromCatalog(getCatalogItem('Belt')!)(fighter(id))
  const { containers } = addItemToContainer(quiver.id, 'quick', arrows)(addItemToContainer('Belt', 'quick', quiver)(belted))
  return { ...(regripItem(bow.id, 2)(holdItem(bow)({ ...fighter(id), containers }))), usedSurge: 'focus' }
}

function wielder(id: string, weapon: string, abilities: string[] = []): CampaignCharacter {
  const item = ItemSchema.parse({ name: weapon, type: 'weapon', refId: weapon, bulk: 3 })
  return regripItem(item.id, 2)(holdItem(item)(fighter(id, abilities)))
}

function spearman(id: string, abilities: string[] = []): CampaignCharacter {
  return wielder(id, 'Short Spear', abilities)
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
// every default a step offers and passing up any escape a stun opens, disarm
// an intercept opens or flee a strike leaves, and returns the order in which its root
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
    const passedUp = open.step === 'define' && (open.kind === 'fleeFollowUp' || (open.kind === 'move' && open.spawnedBy !== null) || (open.kind === 'grapple' && (open.maneuver === 'escape' || open.recipe === 'interceptDisarm')))
    const steps = passedUp ? [withdrawSpawnedAction(newId)] : [rollAction(() => face, newId), payAction(newId), resolveAction(newId)]
    const next = steps.map((step) => step(s)).find((t) => t !== s)
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
  s = declareAction('atk', { kind: 'shoot', weaponKey: s.characters.atk.held[0].id, attack: 'shoot', variant: 'basic', ammoId: 'arrows' }, newId)(s)
  s = commitAction(() => 5, newId)(setTarget('def')(s))
  return everyoneAttacks(s, ['t1', 't2'])
}

// A walk of three cells straight at two spearmen with reach 2, stood side by
// side, the move committed (combat.tex "Opportunity Attack": "moving towards
// a melee weapon while within its attack range").
function walkPastSpearmen(): CombatState {
  let s = onBoard({ m: [0, 0], r1: [4, 0], r2: [4, -1] }, fighter('m'), spearman('r1'), spearman('r2'))
  s = declareAction('m', { kind: 'move' }, newId)(s)
  s = commitAction(() => 5, newId)(amendAction({ movement: 'basic', path: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }] })(s))
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
  s = commitAction(() => 5, newId)(setTarget('def')(s))
  return everyoneAttacks(s, ['f1', 'f2'])
}

// A has grabbed B and pushes them a block straight at a spearman with reach
// 2 who already has B in reach, B staying put passively and the spearman
// answering it (combat.tex "Push and drag"; "Opportunity Attack": "moving
// towards a melee weapon while within its attack range").
function pushTowardsSpearman(): CombatState {
  return moveGrabbedGroup({ a: [0, 0], b: [1, 0], t: [3, 0] }, spearman('t'), [{ q: 1, r: 0 }])
}

// A grabs B and declares a careful block of push along the way given,
// spending 2 AP for +5 against B's equal Force ("the losing side must
// decide first"), committed for third parties to answer.
function moveGrabbedGroup(placements: Record<string, [number, number]>, third: CampaignCharacter, path: Coord[]): CombatState {
  let s = onBoard(placements, fighter('a'), fighter('b'), third)
  s = declareAction('a', { kind: 'strike', grab: true, weaponKey: 'natural:Unarmed', attack: 'grapple', variant: 'basic' }, newId)(s)
  s = resolveAction(newId)(rollAction(() => 50, newId)(commitAction(() => 5, newId)(setTarget('b')(s))))
  s = declareAction('a', { kind: 'drag', movement: 'careful', boost: true }, newId)(s)
  s = commitAction(() => 5, newId)(amendAction({ path })(setTarget('b')(s)))
  expect(getOpenAction(s)?.kind).toBe('drag')
  expect(getOpenAction(s)?.step).toBe('react')
  return everyoneAttacks(s, [third.id])
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

  // The table's ruling: only a stun of the pusher stops the push; one who
  // is dragged and interrupted is still dragged all the way.
  it('does not stop a push when the one it interrupts is dragged', () => {
    const { state } = playOut(pushTowardsSpearman(), LAND)
    expect(state.actions.find((a) => a.kind === 'strike' && a.targetId === 'b' && a.step === 'done' && a.interruption !== 'none')).toBeDefined()
    expect(state.board?.placements.b?.cell).toEqual({ q: 2, r: 0 })
    expect(state.board?.placements.a?.cell).toEqual({ q: 1, r: 0 })
  })

  // The table's ruling: the pusher goes along with the group, so like
  // running and jumping the push carries on through an interruption; only a
  // stun of the pusher stops it, one step short of the stretch the attack
  // fired on. A leaves [0, 0] dragging B from [1, 0] a block towards the
  // attacker, who has A in reach and strikes as A comes closer.
  it.each([
    { weapon: 'Short Spear', a: { q: -1, r: 0 }, b: { q: 0, r: 0 } },
    { weapon: 'Greatsword', a: { q: 0, r: 0 }, b: { q: 1, r: 0 } },
  ])('stops a push whose pusher a $weapon hits only if it stuns them', ({ weapon, a, b }) => {
    const s = moveGrabbedGroup({ a: [0, 0], b: [1, 0], t: [-2, 0] }, wielder('t', weapon), [{ q: -1, r: 0 }])
    const { state } = playOut(s, LAND)
    const strike = state.actions.find((x) => x.kind === 'strike' && x.actorId === 't')
    expect(strike?.kind === 'strike' && [strike.targetId, strike.interruption]).toEqual(['a', weapon === 'Greatsword' ? 'stunned' : 'interrupted'])
    expect(state.board?.placements.a?.cell).toEqual(a)
    expect(state.board?.placements.b?.cell).toEqual(b)
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

// combat.tex "Interruption": "The AP from the interrupted action can be
// repurposed for the reaction, but the amount spent must be the highest
// between the action and the reaction." The table's ruling: it pays towards
// the first defense, the one against the attack the action was given up
// for; later defenses pay in full.
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
  // who stand beside where it lands, both clearing the reflex.
  function grenadeAtTwo(): CombatState {
    const base = fighter('t')
    const grenade = ItemSchema.parse({ name: 'Grenade', type: 'weapon', refId: 'Grenade', bulk: 1 })
    const charged = { ...grenade, charge: { key: 'shock-explosive', effects: produceEffects(base, SPELLS['shock-explosive'].effects) } }
    const thrower = { ...(holdItem(charged)(base)), usedSurge: 'focus' as const }
    let s = onBoard({ t: [-5, 0], x: [0, -1], y: [0, 1] }, thrower, fighter('x'), fighter('y'))
    s = declareAction('t', { kind: 'throw', itemId: charged.id, to: { q: 0, r: 0 } }, newId)(s)
    s = commitAction(() => 5, newId)(s)
    for (const id of ['x', 'y']) s = declareReaction(id, { kind: 'avoidExplosion' }, newId)(s)
    return rollAction(() => 50, newId)(s)
  }

  // One walks 3m out of it, the other skips the escape.
  it('reaches only who is still in the area once the escapes are walked', () => {
    let s = grenadeAtTwo()
    const escaping = () => getOpenAction(s)!.actorId
    for (let i = 0; i < 5 && getOpenAction(s)?.kind === 'move'; i++) {
      s = escaping() === 'x'
        ? commitAction(() => 5, newId)(amendAction({ movement: 'basic', path: [{ q: 0, r: -2 }, { q: 0, r: -3 }, { q: 0, r: -4 }] })(s))
        : withdrawSpawnedAction(newId)(s)
    }
    const blast = s.actions.find((a) => a.kind === 'blast')
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
  return commitAction(() => 5, newId)(setTarget(target.id)(s))
}

// abilities.tex "Counterattack": "Both attacks are made against the
// opponent's SD. The attack with the higher result hits first, having the
// chance to interrupt the opponent. The counterattack receives -2 to hit."
// The table's ruling: on a tie both land, neither interrupting the other.
describe('a counterattack', () => {
  // The dice are the thrust's, then the counterattack's; every hit here
  // interrupts. The strikes, in the order they landed.
  function strikes(faces: number[]): Action[] {
    const def = spearman('def', ['counterattack'])
    let s = declareReaction('def', { kind: 'counterattack' }, newId)(thrustAt(def))
    const [row] = getAttackOptions(s.characters.def, 'strike')
    s = amendReaction('def', { weaponKey: row.weaponKey, attack: row.attack, variant: row.variant })(s)
    const dice = [...faces]
    s = rollAction(() => dice.shift()!, newId)(s)
    for (let i = 0; i < 5 && getOpenAction(s); i++) s = resolveAction(newId)(s)
    return s.history.map((id) => s.actions.find((a) => a.id === id)!)
  }

  // Who struck, in the order they landed, and whether it hit.
  function landings(faces: number[]): { by: string; hit: boolean }[] {
    return strikes(faces).map((a) => ({ by: a.actorId, hit: a.kind === 'strike' && a.facts !== null }))
  }

  it('that rolls higher lands first, and the attack it interrupts lands nothing', () => {
    expect(landings([3, 9])).toEqual([{ by: 'def', hit: true }, { by: 'atk', hit: false }])
  })

  it('that rolls lower is broken by the attack that interrupts it', () => {
    expect(landings([9, 5])).toEqual([{ by: 'atk', hit: true }])
  })

  // 7 less the counterattack's 2 is the thrust's 5. What the tied strike
  // lands still interrupts the attacker; it only does not break the attack.
  it('that rolls the same lands along with the attack', () => {
    expect(landings([5, 7])).toEqual([{ by: 'def', hit: true }, { by: 'atk', hit: true }])
    const [tied] = strikes([5, 7])
    expect(tied.kind === 'strike' && tied.interruption).toBe('interrupted')
  })
})

// abilities.tex "Riposte": "After defending a melee attack that misses or
// grazes, the character can make an attack with a +2 bonus to hit
// immediately after, if in range. The attack costs 1 AP less than the normal
// attack if made with an object different from the one used for defense."
describe('a riposte', () => {
  // A thrust that misses a shield-bearer who knows Riposte, blocking with
  // the shield, evading, or standing on their SD.
  function missedShieldBearer(defense: 'block' | 'evade' | null): CombatState {
    const shield = ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 2 })
    let s = thrustAt(holdItem(shield)(fighter('def', ['riposte'])))
    const option = getAvailableActions(s, 'def').find((o) => o.draft.kind === defense && (o.draft.kind !== 'block' || o.draft.weaponKey === shield.id))
    if (option) s = declareReaction('def', option.draft, newId)(s)
    // the thrust misses, and the percentiles that follow break nothing
    let thrown = 0
    return resolveAction(newId)(rollAction(() => (thrown++ === 0 ? MISS : 5), newId)(s))
  }

  // The table's rulings: follow-ups are a choice, one per character, and a
  // melee attack leaves its target a flee (combat.tex "Flee").
  it('is one choice with the flee: taken, no flee follows; passed up, the flee is offered', () => {
    const offered = missedShieldBearer('evade')
    expect(getOpenAction(withdrawSpawnedAction(newId)(offered))).toMatchObject({ kind: 'fleeFollowUp', actorId: 'def' })
    const [row] = getAttackOptions(offered.characters.def, 'strike')
    const declared = commitAction(() => 5, newId)(amendAction({ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant })(offered))
    expect(getOpenAction(resolveAction(newId)(rollAction(() => MISS, newId)(declared)))).toBeNull()
  })

  // What each basic attack the riposter holds is cheaper by, split by
  // whether it is made with the shield.
  function discounts(s: CombatState): { shield: number[]; other: number[] } {
    const shield = s.characters.def.held[0].id
    const less = getAttackOptions(s.characters.def, 'strike').filter((o) => o.variant === 'basic').map((o) => {
      const declared = amendAction({ weaponKey: o.weaponKey, attack: o.attack, variant: o.variant })(s)
      return { shield: o.weaponKey === shield, less: o.AP - getOwnCost(declared, getOpenAction(declared)!)!.AP }
    })
    return { shield: less.filter((l) => l.shield).map((l) => l.less), other: less.filter((l) => !l.shield).map((l) => l.less) }
  }

  it('is offered to one who defended actively, at the attacker', () => {
    const open = getOpenAction(missedShieldBearer('block'))
    expect(open).toMatchObject({ kind: 'strike', actorId: 'def', targetId: 'atk', step: 'define' })
  })

  it('is not offered to one who stood on their SD', () => {
    expect(getOpenAction(missedShieldBearer(null))?.kind).not.toBe('strike')
  })

  it('costs 1 AP less only with an object other than the one that defended', () => {
    const { shield, other } = discounts(missedShieldBearer('block'))
    expect(shield).toEqual([0])
    expect(new Set(other)).toEqual(new Set([1]))
  })

  // The table's ruling: an evade is made with no object, so any riposte after
  // one is made with another.
  it('costs 1 AP less with anything after an evade', () => {
    const { shield, other } = discounts(missedShieldBearer('evade'))
    expect(new Set([...shield, ...other])).toEqual(new Set([1]))
  })

  // The table's ruling: a riposte draws no opportunity attack from those
  // flanking the riposter, though its target still defends. A spearman stands
  // behind the riposter, flanking them (combat.tex "Flanking"), as the same
  // punch made on the riposter's own initiative shows.
  it('draws no opportunity attack from those flanking the riposter', () => {
    const punch = { weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' } as const
    const start = onBoard({ atk: [0, 0], def: [1, 0], f: [2, 0] }, spearman('atk'), fighter('def', ['riposte']), spearman('f'))
    const [row] = getAttackOptions(start.characters.atk, 'strike')
    let s = declareAction('atk', { kind: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(start)
    s = declareReaction('def', { kind: 'evade' }, newId)(commitAction(() => 5, newId)(setTarget('def')(s)))
    s = commitAction(() => 5, newId)(amendAction(punch)(resolveAction(newId)(rollAction(() => MISS, newId)(s))))
    const own = commitAction(() => 5, newId)(setTarget('atk')(declareAction('def', { kind: 'strike', ...punch }, newId)(start)))
    const kinds = (state: CombatState) => getTriggers(state, getOpenAction(state)!).map((t) => t.kind)
    expect(kinds(own)).toContain('opportunityAttack')
    expect(kinds(s)).not.toContain('opportunityAttack')
    expect(kinds(s)).toContain('evade')
  })
})

// combat.tex "Hook Attack": "a reaction against running targets that move
// away from the weapon within two spaces, which are both inside its melee
// range. On a hit, the character can spend +2 AP +1STA to get" its damage;
// "If the attack was aimed at the legs or head, the post hit effect is a
// knockdown attempt which cannot be reacted against if they are running or
// jumping." The table's ruling: the knockdown comes only once the damage is
// bought, and costs nothing more.
describe('a hook attack', () => {
  // A halberdier hooks, at `location`, a runner setting off away from them,
  // the hook hitting; with its damage bought or not, and landed.
  function hookRunner(location: 'leg' | 'chest', buy: boolean): CombatState {
    let s = onBoard({ h: [0, 0], r: [1, 0] }, wielder('h', 'Halberd'), fighter('r'))
    s = declareAction('r', { kind: 'move' }, newId)(s)
    s = commitAction(() => 5, newId)(amendAction({ movement: 'run', path: [{ q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }, { q: 5, r: 0 }] })(s))
    const option = getAvailableActions(s, 'h').find((o) => o.draft.kind === 'opportunityAttack' && o.available)!
    s = declareReaction('h', option.draft, newId)(s)
    s = amendReaction('h', { weaponKey: s.characters.h.held[0].id, attack: 'hook', variant: 'hook', location })(s)
    s = rollAction(() => 9, newId)(payAction(newId)(s))
    expect(getOpenAction(s)?.roll?.degree).toBe('hit')
    return resolveAction(newId)(buy ? spendHOP('hook')(s) : s)
  }

  it('knocks a runner hooked at the legs down, unresisted, and the run stops there', () => {
    const hooked = hookRunner('leg', true)
    const knockdown = getOpenAction(hooked)
    expect(knockdown).toMatchObject({ kind: 'grapple', maneuver: 'knockdown', actorId: 'h', targetId: 'r', unresisted: true })
    expect(getTriggers(hooked, knockdown!)).toEqual([])
    const { state } = playOut(commitAction(() => 20, newId)(hooked), MISS)
    expect(state.characters.r.afflictions).toContain('prone')
    expect(state.board?.placements.r?.cell).toEqual({ q: 1, r: 0 })
  })

  it.each([
    { name: 'without its damage bought', location: 'leg' as const, buy: false },
    { name: 'aimed at the chest', location: 'chest' as const, buy: true },
  ])('opens no knockdown $name', ({ location, buy }) => {
    expect(hookRunner(location, buy).actions.some((a) => a.kind === 'grapple')).toBe(false)
  })
})

// combat.tex "Protect": "It is possible to defend an ally by staying within
// one space distance of the line between attacker and target. The defender
// can block or intercept an attack directed at an ally." The table's
// rulings: anyone may; a strike has to beat every defense, as a shot its
// guards; Defender and Defensive Advance are steps taken with the defense.
describe('protecting the target of a strike', () => {
  function shielded(id: string, abilities: string[] = []): CampaignCharacter {
    const shield = ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 2 })
    return holdItem(shield)(fighter(id, abilities))
  }

  // A spearman thrusts at a target two spaces away, who knows Defensive
  // Advance. By the line: one right beside it, one two spaces off it who
  // knows Defender, and one well away from it.
  function thrustPastBystanders(): CombatState {
    let s = onBoard({ atk: [0, 0], def: [2, 0], p: [1, -1], d: [1, -2], o: [0, 3] },
      spearman('atk'), shielded('def', ['defensive-advance']), shielded('p'), shielded('d', ['defender']), shielded('o'))
    const [row] = getAttackOptions(s.characters.atk, 'strike')
    s = declareAction('atk', { kind: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(s)
    return commitAction(() => 5, newId)(setTarget('def')(s))
  }
  const shieldOption = (s: CombatState, id: string, label: string) => getAvailableActions(s, id).find((o) => getOptionLabel(s, id, o) === `${label} with Wooden Shield`)
  const kinds = (s: CombatState, id: string) => [...new Set(getAvailableActions(s, id).map((o) => o.draft.kind))]
  // The step open to the one declared, picked on the board: the first cell
  // a click there takes.
  function pickStep(s: CombatState): CombatState {
    for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) {
      const picked = pickCell({ q, r }, newId)(s)
      if (picked !== s) return picked
    }
    return s
  }

  it('offers a block and an intercept to one by the line, and nothing to one away from it', () => {
    const s = thrustPastBystanders()
    expect(kinds(s, 'p')).toEqual(['block', 'intercept'])
    expect(kinds(s, 'o')).toEqual([])
  })

  it("scores the strike against a protector's block when the target stands on their SD", () => {
    const start = thrustPastBystanders()
    const s = declareReaction('p', shieldOption(start, 'p', 'block')!.draft, newId)(start)
    const strike = getOpenAction(s)!
    expect(getDefendingReaction(s, strike)?.actorId).toBe('p')
    expect(getDLTerms(s, strike).map((t) => t.label)).toContain('cover')
  })

  // combat.tex "Intercept": "It requires the defender to be in short range."
  // abilities.tex "Defensive Advance": "Spend 1 STA to move forward to get in
  // range to intercept, adding shield cover to the defense."
  it('closes an intercept out of short range, but for a Defensive Advance a step closer, with cover', () => {
    const start = thrustPastBystanders()
    expect(shieldOption(start, 'def', 'intercept')?.reason).toBe('out of short range')
    const advance = shieldOption(start, 'def', 'defensive advance')!
    expect(advance.cost).toEqual({ AP: 3, STA: 1 })
    const s = pickStep(declareReaction('def', advance.draft, newId)(start))
    expect(getDLTerms(s, getOpenAction(s)!).map((t) => t.label)).toContain('cover')
    const { state } = playOut(s, MISS)
    expect(state.board?.placements.def?.cell).toEqual({ q: 1, r: 0 })
  })

  // abilities.tex "Defender": "Allows you to spend 1 STA to move 1 basic
  // movement as a reaction to position yourself to defend someone."
  it('lets one who knows Defender step onto the line to block, for 1 STA more', () => {
    const start = thrustPastBystanders()
    const block = shieldOption(start, 'd', 'block')!
    expect(block.cost).toEqual({ AP: 2, STA: 1 })
    const declared = declareReaction('d', block.draft, newId)(start)
    const s = pickStep(declared)
    expect(s).not.toBe(declared)
    const { state } = playOut(s, MISS)
    expect(state.board?.placements.d?.cell).toEqual({ q: 0, r: -1 })
  })
})

// combat.tex "Disarm": "Can be used by spending +1AP+1STA when intercept
// stops an attack" — a discount off the maneuver's usual 3 AP + 1 STA
// (combat.tex "Grapple Maneuvers"), and open with neither in a grapple.
describe('a disarm an intercept opens', () => {
  function facingOff(): CombatState {
    const dagger = ItemSchema.parse({ name: 'Dagger', type: 'weapon', refId: 'Dagger', bulk: 1 })
    const shield = ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 2 })
    let s = onBoard({ atk: [0, 0], def: [1, 0] }, holdItem(dagger)(fighter('atk')), holdItem(shield)(fighter('def')))
    const [row] = getAttackOptions(s.characters.atk, 'strike')
    s = declareAction('atk', { kind: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(s)
    return commitAction(() => 5, newId)(setTarget('def')(s))
  }

  it('opens at the attacker, discounted, when the intercept stops the strike', () => {
    const start = facingOff()
    const intercept = getAvailableActions(start, 'def').find((o) => o.draft.kind === 'intercept')!
    const declared = declareReaction('def', intercept.draft, newId)(start)
    const s = resolveAction(newId)(rollAction(() => MISS, newId)(declared))
    const opened = getOpenAction(s)
    expect(opened).toMatchObject({ kind: 'grapple', maneuver: 'disarm', actorId: 'def', targetId: 'atk' })
    expect(getOwnCost(s, opened!)).toEqual({ AP: 1, STA: 1 })
  })

  it('may be passed up, leaving the dagger where it is', () => {
    const start = facingOff()
    const intercept = getAvailableActions(start, 'def').find((o) => o.draft.kind === 'intercept')!
    const declared = declareReaction('def', intercept.draft, newId)(start)
    const { state } = playOut(declared, MISS)
    expect(state.characters.atk.held.some((i) => i.name === 'Dagger')).toBe(true)
    expect(state.floor).toEqual([])
  })
})

// combat.tex "Sweeping Attack": "hits everything in a semicircle. Decide
// whether to attack from right to left or vice versa and attack the enemies
// in that order in a 180-degree arc ... If one character is behind another,
// only the closest is hit ... Sweeping attacks do not draw attacks of
// opportunity from any of its targets." The table's ruling: one roll per
// target, the sweep paid once.
describe('a sweeping attack', () => {
  // A longsword (reach 2) swung clockwise from `t1`, east of the attacker:
  // `t2` and `t3` a sixth and a third of a turn on, `hidden` behind `t2`,
  // `back` two thirds of a turn round, outside the semicircle.
  function sweepAt(t1: CampaignCharacter = fighter('t1')): CombatState {
    let s = onBoard({ atk: [0, 0], t1: [1, 0], t2: [1, -1], t3: [0, -1], hidden: [2, -2], back: [-1, 1] },
      wielder('atk', 'Longsword'), t1, fighter('t2'), fighter('t3'), fighter('hidden'), fighter('back'))
    s = declareAction('atk', { kind: 'strike', weaponKey: s.characters.atk.held[0].id, attack: 'cut', variant: 'sweep', sweepDirection: 'clockwise' }, newId)(s)
    return commitAction(() => 5, newId)(setTarget('t1')(s))
  }

  it('strikes each target in the arc in turn, never one behind another or outside it, and is paid once', () => {
    const start = sweepAt()
    const cost = getOwnCost(start, getOpenAction(start)!)!
    const { state, landed } = playOut(start, MISS)
    expect(landed.filter((a) => a.kind === 'strike').map((a) => a.targetId)).toEqual(['t1', 't2', 't3'])
    expect(start.characters.atk.resources.AP - state.characters.atk.resources.AP).toBe(cost.AP)
  })

  it('draws no opportunity attack from its targets, only from those it does not reach', () => {
    const opportunities = getTriggers(sweepAt(), getOpenAction(sweepAt())!).filter((t) => t.kind === 'opportunityAttack')
    expect(opportunities.map((t) => t.characterId)).toEqual(['back'])
  })

  // Broke: a target next to another was offered Protect on that one's
  // strike, so they chose a defense twice in one sweep.
  it('asks each target for a defense only on their own strike', () => {
    const start = sweepAt()
    const blockers = getTriggers(start, getOpenAction(start)!).filter((t) => t.kind === 'block').map((t) => t.characterId)
    expect(blockers.filter((id) => ['t2', 't3'].includes(id))).toEqual([])
  })

  // The table's ruling: an opportunity attack may sweep; only the one who
  // drew it answers at the interruption's -2 (combat.tex "Interruption").
  it('made as an opportunity attack, goes on through the arc from the one who drew it', () => {
    let s = onBoard({ atk: [0, 0], t1: [1, 0], t2: [1, -1], far: [5, 0] }, wielder('atk', 'Longsword'), archer('t1'), fighter('t2'), fighter('far'))
    s = declareAction('t1', { kind: 'shoot', weaponKey: s.characters.t1.held[0].id, attack: 'shoot', variant: 'basic', ammoId: 'arrows' }, newId)(s)
    s = commitAction(() => 5, newId)(setTarget('far')(s))
    s = declareReaction('atk', { kind: 'opportunityAttack', weaponKey: s.characters.atk.held[0].id, attack: 'cut', variant: 'sweep', sweepDirection: 'clockwise' }, newId)(s)
    const { landed } = playOut(s, MISS)
    expect(landed.filter((a) => a.kind === 'strike').map((a) => a.targetId)).toEqual(['t1', 't2'])
  })

  // combat.tex "Intercept": "interrupts the attack"
  it('goes no further once an intercept stops it', () => {
    const shield = ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 2 })
    const start = sweepAt(holdItem(shield)(fighter('t1')))
    const intercept = getAvailableActions(start, 't1').find((o) => o.draft.kind === 'intercept')!
    const { landed } = playOut(declareReaction('t1', intercept.draft, newId)(start), MISS)
    expect(landed.filter((a) => a.kind === 'strike').map((a) => a.targetId)).toEqual(['t1'])
  })
})

// combat.tex "Sprays": "Sprays target all characters in range, which their
// reflex saves to escape ... The attacker can choose the exact direction of
// the cone after the movement." The table's ruling: nothing is aimed before
// the reflexes; the range around the attacker is only shown.
describe('a spray', () => {
  // A flamethrower (4m) cast from between two in range, one east and one
  // west of the caster, with a third out of range.
  function flamesCast(): CombatState {
    const flamethrower = ItemSchema.parse({ name: 'Flamethrower', type: 'magical', bulk: 2, source: { damage: [{ kind: 'burn', value: 15 }], ammo: 20 } })
    const caster = { ...(holdItem(flamethrower)(fighter('c'))), spells: { flamethrower: { method: 'intuitive' as const, practice: 0 } }, usedSurge: 'focus' as const }
    const s = onBoard({ c: [0, 0], x: [2, 0], y: [-2, 0], z: [6, 0] }, caster, fighter('x'), fighter('y'), fighter('z'))
    return resolveAction(newId)(commitAction(() => 9, newId)(declareAction('c', { kind: 'cast', key: 'flamethrower' }, newId)(s)))
  }

  it('asks everyone in its range for their reflexes, with nothing to aim first', () => {
    const s = flamesCast()
    expect(getOpenAction(s)).toMatchObject({ kind: 'explosion', step: 'react' })
    const asked = ['x', 'y', 'z'].filter((id) => getAvailableActions(s, id).some((o) => o.draft.kind === 'avoidExplosion'))
    expect(asked).toEqual(['x', 'y'])
  })

  it('reaches only the cone it is pointed in once the reflexes are done', () => {
    const s = resolveAction(newId)(aimExplosion(0)(payAction(newId)(flamesCast())))
    const blast = s.actions.find((a) => a.kind === 'blast')
    expect(Object.keys(blast?.kind === 'blast' ? blast.facts ?? {} : {})).toEqual(['x'])
  })
})

// combat.tex "Flee": "This reaction interrupts the opponents turn, which is
// resumed after the flee." The table's rulings: the mover stops where the
// first flee was triggered, and everyone who fled gets their turn, in the
// order they declared it.
describe('flee', () => {
  it('stops the move short of the first flee, then gives each fleer a turn in declaration order before the mover resumes', () => {
    let s = onBoard({ m: [0, 0], near: [7, 0], far: [9, 0] }, fighter('m'), fighter('near'), fighter('far'))
    s = declareAction('m', { kind: 'move' }, newId)(s)
    s = commitAction(() => 5, newId)(amendAction({ movement: 'basic', path: [1, 2, 3, 4, 5].map((q) => ({ q, r: 0 })) })(s))
    for (const id of ['far', 'near']) {
      const option = getAvailableActions(s, id).find((o) => o.draft.kind === 'flee' && o.available)!
      s = declareReaction(id, option.draft, newId)(s)
    }
    s = playOut(s, MISS).state
    expect(s.board!.placements.m.cell).toEqual({ q: 2, r: 0 })

    const turns = [s.inTurnCharacter]
    for (let i = 0; i < 2; i++) {
      s = endTurn(s)
      turns.push(s.inTurnCharacter)
    }
    expect(turns).toEqual(['far', 'near', 'm'])
  })

  // combat.tex "Flee": "after receiving a melee attack". The table's
  // rulings: that flee is a follow-up to the strike, not a reaction beside
  // the defense, and it is not offered to one who cannot pay the surge.
  it('after a strike, comes once it lands, and only to a target who can pay the surge', () => {
    const struck = (STA: number) => {
      const dagger = ItemSchema.parse({ name: 'Dagger', type: 'weapon', refId: 'Dagger', bulk: 1 })
      const def = fighter('def')
      let s = onBoard({ atk: [0, 0], def: [1, 0] }, holdItem(dagger)(fighter('atk')), { ...def, resources: { ...def.resources, STA } })
      const [row] = getAttackOptions(s.characters.atk, 'strike')
      s = declareAction('atk', { kind: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(s)
      return commitAction(() => 5, newId)(setTarget('def')(s))
    }
    const land = (s: CombatState) => resolveAction(newId)(rollAction(() => MISS, newId)(s))
    expect(getAvailableActions(struck(6), 'def').some((o) => o.draft.kind === 'flee')).toBe(false)
    expect(getOpenAction(land(struck(6)))).toMatchObject({ kind: 'fleeFollowUp', actorId: 'def' })
    expect(getOpenAction(land(struck(2)))).toBeNull()
  })
})

// combat.tex "Coordinated Shots": "Whenever an ally shoots a target, it is
// possible to target the same target in the same action, as long as they are
// in range. The target defends all shots with a single action." The table's
// rulings: anyone with a shooting weapon may join, at their own price, and
// the evasion's escape is the one the worst of the shots leaves.
describe('coordinated shots', () => {
  const bowOf = (s: CombatState, id: string) => s.characters[id].held[0].id
  const shot = (s: CombatState, id: string) => ({ weaponKey: bowOf(s, id), attack: 'shoot', variant: 'basic', ammoId: 'arrows' })

  // a1 shoots def, who evades; a2 joins with a shot of their own
  function joined(): CombatState {
    let s = onBoard({ a1: [0, 0], a2: [0, 1], def: [-6, 0] }, archer('a1'), archer('a2'), fighter('def'))
    s = declareAction('a1', { kind: 'shoot', ...shot(s, 'a1') }, newId)(s)
    s = commitAction(() => 5, newId)(setTarget('def')(s))
    s = declareReaction('def', { kind: 'evasion' }, newId)(s)
    s = declareReaction('a2', { kind: 'joinShot' }, newId)(s)
    return amendReaction('a2', shot(s, 'a2'))(s)
  }
  const shots = (s: CombatState) => s.actions.filter((a) => a.kind === 'shoot')

  it('is open to a shooter other than the target or the one shooting', () => {
    let s = onBoard({ a1: [0, 0], a2: [0, 1], def: [-6, 0] }, archer('a1'), archer('a2'), fighter('def'))
    s = declareAction('a1', { kind: 'shoot', ...shot(s, 'a1') }, newId)(s)
    s = commitAction(() => 5, newId)(setTarget('def')(s))
    const joins = (id: string) => getAvailableActions(s, id).some((o) => o.draft.kind === 'joinShot' && o.available)
    expect(joins('a2')).toBe(true)
    expect(joins('def')).toBe(false)
    expect(joins('a1')).toBe(false)
  })

  it('has every shot rolled against the target\'s one defense, paid once, each landing on its own', () => {
    const { state } = playOut(joined(), LAND)
    const [lead, second] = shots(state)
    const defenses = state.actions.filter((a) => a.kind === 'evasion')
    expect(defenses).toHaveLength(1)
    expect(getDefendingReaction(state, lead)?.id).toBe(defenses[0].id)
    expect(getDefendingReaction(state, second)?.id).toBe(defenses[0].id)
    expect(shots(state).every((a) => a.step === 'done' && a.facts !== null)).toBe(true)
    expect(state.characters.a2.resources.AP).toBeLessThan(12)
  })

  // combat.tex "Evasion": "On a miss, the character does not take the attack
  // and can spend their movement surge immediately to escape". The table's
  // ruling: the lead shot's result is the one that counts.
  const playedJoined = (leadFace: number, joinedFace: number) => {
    let s = rollAction(() => leadFace, newId)(joined())
    s = resolveAction(newId)(rollAction(() => joinedFace, newId)(s))
    return resolveAction(newId)(s)
  }
  const escapes = (s: CombatState) => s.actions.filter((a) => a.kind === 'fleeFollowUp')

  it('offers the escape a miss leaves by the result of the lead shot', () => {
    expect(escapes(playedJoined(MISS, MISS))).toHaveLength(1)
    expect(escapes(playedJoined(LAND, MISS))).toHaveLength(0)
  })

  // An evader a joined arrow interrupted was offered the flee the lead's miss
  // leaves.
  it('offers no escape to an evader a joined shot interrupted', () => {
    expect(escapes(playedJoined(MISS, LAND))).toHaveLength(0)
  })

  // The table's ruling: the joined shots are played out in the order they
  // were declared, before the lead's effect.
  it('plays the joined shots in the order they were declared, ahead of the lead', () => {
    let s = onBoard({ a1: [0, 0], a2: [0, 1], a3: [1, 1], def: [-6, 0] }, archer('a1'), archer('a2'), archer('a3'), fighter('def'))
    s = declareAction('a1', { kind: 'shoot', ...shot(s, 'a1') }, newId)(s)
    s = commitAction(() => 5, newId)(setTarget('def')(s))
    for (const id of ['a3', 'a2']) s = amendReaction(id, shot(s, id))(declareReaction(id, { kind: 'joinShot' }, newId)(s))
    const { landed } = playOut(s, MISS)
    expect(landed.filter((a) => a.kind === 'shoot').map((a) => a.actorId)).toEqual(['a3', 'a2', 'a1'])
  })

  // The table's ruling: a lead shot voided by an opportunity attack joins
  // nothing, and the evasion gets no move.
  it('is not made, and the evasion does not move, when the lead shot is voided', () => {
    let s = onBoard({ a1: [0, 0], a2: [3, 3], def: [-6, 0], t1: [0, 1], t2: [1, -1] }, archer('a1'), archer('a2'), fighter('def'), spearman('t1'), spearman('t2'))
    s = declareAction('a1', { kind: 'shoot', ...shot(s, 'a1') }, newId)(s)
    s = commitAction(() => 5, newId)(setTarget('def')(s))
    s = declareReaction('def', { kind: 'evasion' }, newId)(s)
    s = amendReaction('a2', shot(s, 'a2'))(declareReaction('a2', { kind: 'joinShot' }, newId)(s))
    const { state } = playOut(everyoneAttacks(s, ['t1', 't2']), LAND)
    expect(state.actions.some((a) => a.kind === 'shoot' && a.actorId === 'a2')).toBe(false)
    expect(state.actions.some((a) => a.kind === 'move')).toBe(false)
  })

  // combat.tex "Guard": someone adjacent to the target who is closer to the
  // shooter than the target is. The table's ruling: each shot has its own
  // angle, so the guard answers the lead's and not one from behind the target.
  it('has a guard answer only the shots it stands in front of', () => {
    const shield = ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 3 })
    let s = onBoard({ a1: [0, 0], a2: [-10, 0], def: [-6, 0], g: [-5, 0] }, archer('a1'), archer('a2'), fighter('def'), holdItem(shield)(fighter('g')))
    s = declareAction('a1', { kind: 'shoot', ...shot(s, 'a1') }, newId)(s)
    s = commitAction(() => 5, newId)(setTarget('def')(s))
    s = amendReaction('a2', shot(s, 'a2'))(declareReaction('a2', { kind: 'joinShot' }, newId)(s))
    s = declareReaction('g', getAvailableActions(s, 'g').find((o) => o.draft.kind === 'guard' && o.available)!.draft, newId)(s)
    const { state } = playOut(s, MISS)
    const [lead, second] = shots(state)
    expect(getDefendingReaction(state, lead)?.actorId).toBe('g')
    expect(getDefendingReaction(state, second)).toBeNull()
  })
})

// gear.tex "Net", "Explosion": a thrown net's explosion ties each one it
// catches to the thrower, at the DL of the zone they stand in (the table's
// ruling: critical at the centre, a hit across the rest of its 2m radius),
// and the net stays in the thrower hand by its rope.
describe('a net', () => {
  let m = 0
  const netId = () => `net${++m}`
  const net = ItemSchema.parse({ name: 'Net', type: 'weapon', refId: 'Net', bulk: 2 })

  // `t` throws it at the cell the others stand in, none of them stirring.
  function netted(): CombatState {
    const thrower = { ...(regripItem(net.id, 2)(holdItem(net)(fighter('t')))), usedSurge: 'focus' as const }
    let s = onBoard({ t: [-3, 0], x: [0, 0], y: [1, 0], z: [2, 0], c: [3, 0] }, thrower, fighter('x'), fighter('y'), fighter('z'), wielder('c', 'Longsword'))
    s = declareAction('t', { kind: 'throw', itemId: net.id, to: { q: 0, r: 0 } }, netId)(s)
    s = commitAction(() => 5, netId)(s)
    for (const id of ['x', 'y', 'z']) s = declareReaction(id, { kind: 'avoidExplosion' }, netId)(s)
    s = rollAction(() => 50, netId)(s)
    for (let i = 0; i < 8 && getOpenAction(s)?.kind === 'move'; i++) s = withdrawSpawnedAction(netId)(s)
    return playOut(s, 5).state
  }

  it('ties each one it catches, and stays in the hand that threw it', () => {
    const s = netted()
    const dls = Object.fromEntries(getTethers(s).map((t) => [t.members[1], t.dl]))
    expect(dls).toEqual({ x: 5, y: 3, z: 3 })
    expect(s.characters.t.held.map((i) => i.id)).toContain(net.id)
  })

  // gear.tex "Net": the tethered slips it on a Prestidigitation test against
  // the zone's DL, freed on a hit or better, for two standard actions.
  // gear.tex "Net": either end pulls the other along the tether, only
  // toward themselves, on the push and drag comparison (the table's ruling:
  // Force against Force, the pulled alone moved, the puller paying the
  // block); here 2 AP for +5 against an equal Force.
  it('is pulled toward whoever holds it, one step', () => {
    let s = netted()
    s = declareAction('t', { kind: 'drag', pull: true, boost: true }, netId)(s)
    s = commitAction(() => 5, netId)(amendAction({ path: [{ q: -1, r: 0 }] })(setTarget('x')(s)))
    s = playOut(s, 5).state
    expect(s.board?.placements.x.cell).toEqual({ q: -1, r: 0 })
    expect(s.board?.placements.t.cell).toEqual({ q: -3, r: 0 })
  })

  // gear.tex "Equipment Breakage": a blow that reaches a fibre net's RES breaks
  // it one time in six, and the whole net goes with it; the die for the strike
  // is thrown first, then the two percentile digits.
  it.each([[[9, 0, 1], 0], [[9, 5, 5], 3]] as const)('with the dice %j leaves %i of the three tethered once a sword cuts it', (faces, remaining) => {
    let s = netted()
    const [{ weaponKey, attack, variant }] = getAttackOptions(s.characters.c, 'strike')
    s = declareAction('c', { kind: 'cut', weaponKey, attack, variant }, netId)(s)
    let i = 0
    s = commitAction(() => faces[i++] ?? 0, netId)(setTarget('z')(s))
    expect(getTethers(s).length).toBe(remaining)
  })

  it.each([[1, 3], [10, 2]] as const)('with a die of %i leaves %i of the three tethered', (face, remaining) => {
    let s = netted()
    s = declareAction('x', { kind: 'slip' }, netId)(s)
    s = commitAction(() => face, netId)(setTarget('t')(s))
    expect(getTethers(playOut(s, face).state).length).toBe(remaining)
  })
})

// spells.tex "Sustained Lightning": the caster holds an arc to the target
// while it is within range; it "ends if the target ... touches the caster,
// in which case the arc short-circuits, causing damage to both".
describe('sustained lightning', () => {
  let m = 0
  const arcId = () => `arc${++m}`

  // `c` casts it at `x`, `at` cells away, with a die that hits.
  function lightningAt(at: number): CombatState {
    const electrite = ItemSchema.parse({ name: 'Electrite', type: 'magical', bulk: 1, source: { damage: [{ kind: 'electric', value: 10 }], ammo: 20 } })
    const caster = { ...(holdItem(electrite)(fighter('c'))), spells: { 'sustained-lightning': { method: 'intuitive' as const, practice: 0 } }, usedSurge: 'focus' as const }
    let s = onBoard({ c: [0, 0], x: [at, 0] }, caster, fighter('x'))
    s = declareAction('c', { kind: 'cast', key: 'sustained-lightning' }, arcId)(s)
    return playOut(commitAction(() => 20, arcId)(setTarget('x')(s)), 20).state
  }

  it('is held to a target in range, which the caster keeps', () => {
    const s = lightningAt(5)
    expect(s.binds.map((b) => b.kind)).toEqual(['arc'])
    expect(s.characters.c.active.map((e) => e.key)).toContain('sustained-lightning')
  })

  it('short-circuits onto both ends of a target that touches the caster, ending the spell', () => {
    const s = lightningAt(1)
    expect(s.binds).toEqual([])
    expect(s.characters.c.active.map((e) => e.key)).not.toContain('sustained-lightning')
    for (const id of ['c', 'x']) expect(s.characters[id].injuries.injuryLevel).toBeGreaterThan(0)
  })
})

// spells.tex "Telepathic Link": a target who does not beat the will test is
// linked to the caster, each link adds 3 to the DL of the caster's spells, and
// the link is broken "until the maximum distance is exceeded" (20m).
describe('telepathic link', () => {
  let m = 0
  const linkId = () => `link${++m}`

  // `c` casts it at `x`, `at` cells away; `x` fails the test its cast opens.
  function linkedAt(at: number): CombatState {
    const caster = { ...fighter('c'), spells: { 'telepathic-link': { method: 'intuitive' as const, practice: 0 } }, usedSurge: 'focus' as const }
    let s = onBoard({ c: [0, 0], x: [at, 0] }, caster, fighter('x'))
    s = declareAction('c', { kind: 'cast', key: 'telepathic-link' }, linkId)(s)
    return playOut(commitAction(() => 20, linkId)(setTarget('x')(s)), 0).state
  }

  it('holds one link per target, which raises the caster\'s casting DL', () => {
    const s = linkedAt(5)
    expect(s.binds.map((b) => b.kind)).toEqual(['link'])
    expect(getSpellOptions(s, s.characters.c).find((o) => o.key === 'telepathic-link')?.DL).toBe(3)
  })

  it('lets go of a target beyond its range', () => {
    expect(linkedAt(25).binds).toEqual([])
  })
})

// gear.tex "Equipment Breakage": a blow that reaches an object's RES gives it
// a 1 in 6 chance to break, and impact is dealt to both objects; gear.tex
// "Piercing": a piercing blow only breaks objects when damage > 3x RES. A
// longsword's cut (steel, RES 20) meets a wooden shield of RES 20; a short
// spear's thrust is piercing and well short of 3x.
describe('a blow a block met', () => {
  const shield = ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 2 })

  // `weapon` strikes a shield-bearer who defends as asked. The strike is
  // thrown with `die`, then the percentile (tens, units) is `digit` twice.
  function struck(weapon: string, defense: 'block' | 'evade', die: number, digit: number, breakage = true): CombatState {
    const target = holdItem(shield)(fighter('def'))
    let s = { ...onBoard({ atk: [0, 0], def: [1, 0] }, wielder('atk', weapon), target), breakage }
    const [row] = getAttackOptions(s.characters.atk, 'strike')
    s = declareAction('atk', { kind: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(s)
    s = commitAction(() => 5, newId)(setTarget('def')(s))
    const option = getAvailableActions(s, 'def').find((o) => o.draft.kind === defense && (o.draft.kind !== 'block' || o.draft.weaponKey === shield.id))
    s = declareReaction('def', option!.draft, newId)(s)
    let thrown = 0
    return resolveAction(newId)(rollAction(() => (thrown++ === 0 ? die : digit), newId)(s))
  }

  it('breaks the shield it struck on a low percentile, and not on a high one', () => {
    expect(struck('Longsword', 'block', MISS, 0).characters.def.held[0].broken).toBe(true)
    expect(struck('Longsword', 'block', MISS, 9).characters.def.held[0].broken).toBe(false)
  })

  it('leaves the sword whole against a softer shield, whatever the percentile', () => {
    expect(struck('Longsword', 'block', MISS, 0).characters.atk.held[0].broken).toBe(false)
  })

  it('does not break a shield with a piercing thrust short of 3x its RES', () => {
    expect(struck('Short Spear', 'block', MISS, 0).characters.def.held[0].broken).toBe(false)
  })

  it('does not meet the shield at all when the defender evades', () => {
    expect(struck('Longsword', 'evade', MISS, 0).characters.def.held[0].broken).toBe(false)
  })

  it('goes past the shield on a hit', () => {
    const s = struck('Longsword', 'block', 9, 0)
    expect(s.actions.find((a) => a.kind === 'strike')?.roll?.degree).toBe('hit')
    expect(s.characters.def.held[0].broken).toBe(false)
  })

  it('breaks nothing with the rule switched off', () => {
    expect(struck('Longsword', 'block', MISS, 0, false).characters.def.held[0].broken).toBe(false)
  })
})

// gear.tex "Equipment Breakage": armor takes the blow that lands on it like
// any object, and "Armor Breakage": broken armor is pitted. A gambeson is
// fibre, RES 10, hardness 2.
describe('a blow that lands on armor', () => {
  const gambeson = ItemSchema.parse({ name: 'Gambeson', type: 'armor', refId: 'Gambeson', bulk: 2 })

  // `weapon` (bare hands for null) strikes a gambeson-wearer who stands on
  // their SD. The strike is thrown with `die`, then every percentile digit is
  // `digit`.
  function struck(weapon: string | null, die: number, digit: number, breakage = true): CombatState {
    const attacker = weapon ? wielder('atk', weapon) : fighter('atk')
    let s = { ...onBoard({ atk: [0, 0], def: [1, 0] }, attacker, { ...fighter('def'), worn: gambeson }), breakage }
    const [row] = getAttackOptions(s.characters.atk, 'strike')
    s = declareAction('atk', { kind: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(s)
    s = commitAction(() => 5, newId)(setTarget('def')(s))
    let thrown = 0
    return resolveAction(newId)(rollAction(() => (thrown++ === 0 ? die : digit), newId)(s))
  }
  const pitted = (s: CombatState) => s.characters.def.worn?.broken

  it('pits the armor on a low percentile when the blow reaches its RES', () => {
    expect(pitted(struck('Longsword', 9, 0))).toBe(true)
  })

  it('is not at risk from a fist, whatever the percentile', () => {
    expect(pitted(struck(null, 9, 0))).toBe(false)
  })

  it('is not at risk from a piercing thrust short of 3x its RES', () => {
    expect(pitted(struck('Short Spear', 9, 0))).toBe(false)
  })

  it('is not at risk with the rule switched off', () => {
    expect(pitted(struck('Longsword', 9, 0, false))).toBe(false)
  })
})
