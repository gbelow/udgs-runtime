import { describe, it, expect } from 'vitest'
import type { SceneState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema, OutcomeSchema, type CampaignCharacter } from '../../types'
import { makeAction } from '../factories'
import { holdItem, regripItem } from '../../item/commands/hands'
import { grantAbility } from '../../character/commands/abilities'
import { ABILITIES, type AbilityKey } from '../../abilities'
import { PROTECTION_FAILED_TIER, PROTECTION_RANGE } from '../../tables'
import { getSurgeAP } from '../../character/rules/surge'
import { getAvailableActions } from '../rules/options'
import { getOptionLabel } from '../projections/labels'
import { getAttackOptions, getDefendingReaction, getDLTerms } from '../rules/attack'
import { getOpenAction } from '../rules/log'
import { isOnProtectLine } from '../rules/protect'
import { isProtectionGuard } from '../rules/protection'
import { getAdjacentIds } from '../rules/board/board'
import { archer, board as onBoard } from '../../bot/fixtures'
import { commitAction, declareAction as declareOwnAction, declareReaction, payAction, rollAction, setTarget } from './action'
import { pickCell } from './board'
import { surge } from './turn'
import { meetUnprotected } from './protection'

const declareAction = (...[actorId, draft, newId]: Parameters<typeof declareOwnAction>) => (s: SceneState) =>
  declareOwnAction(actorId, draft, newId)({ ...s, inTurnCharacter: actorId })

let n = 0
const newId = () => `g${++n}`
const MISS = 1

// Guardian adopted, at level 0, and the abilities given.
function fighter(id: string, abilities: AbilityKey[] = []): CampaignCharacter {
  const base = abilities.reduce<CampaignCharacter>((acc, key) => grantAbility(key)(acc), makeCampaignCharacter({ name: id }))
  const trainables = { ...base.trainables, conviction1: { ...base.trainables.conviction1, name: 'Guardian', value: 0, XP: 0 } }
  return { ...base, id, trainables, resources: { ...base.resources, AP: 12, STA: 6 } }
}

function shielded(id: string, abilities: AbilityKey[] = []): CampaignCharacter {
  const shield = ItemSchema.parse({ name: 'Wooden Shield', type: 'weapon', refId: 'Wooden Shield', bulk: 2 })
  return holdItem(shield)(fighter(id, abilities))
}

function spearman(id: string): CampaignCharacter {
  const spear = ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })
  return regripItem(spear.id, 2)(holdItem(spear)(fighter(id)))
}

const xp = (s: SceneState, id: string) => s.characters[id].trainables.conviction1.XP
const attitudeXP = (event: string) => ABILITIES['protection-surge'].attitudes.find((a) => a.on.event === event)?.XP ?? 0
const option = (s: SceneState, id: string, label: string) => getAvailableActions(s, id).find((o) => getOptionLabel(s, id, o) === label)

// The move the declared defense carries, opened as the die is called for,
// drawn to the first cell a click takes, committed and paid, nobody
// answering it.
function takeStep(declared: SceneState): SceneState {
  const s = rollAction(() => MISS, newId)(declared)
  for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) {
    const picked = pickCell({ q, r }, newId)(s)
    if (picked === s) continue
    const committed = commitAction(() => 5, newId)(picked)
    return getOpenAction(committed)?.kind === 'move' ? payAction(newId, () => 5)(committed) : committed
  }
  return s
}

// A spearman thrusts at an ally two spaces away. Off the line, within reach
// of a run: a guardian, and one with a shield who has learned nothing.
function thrustAtAlly(guardian = shielded('g', ['protection-surge'])): SceneState {
  let s = onBoard({ atk: [0, 0], ally: [2, 0], g: [1, 2], o: [2, 2] }, spearman('atk'), fighter('ally'), guardian, shielded('o'))
  const [row] = getAttackOptions(s.characters.atk, 'strike', true)
  s = declareAction('atk', { kind: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(s)
  return commitAction(() => 5, newId)(setTarget('ally')(s))
}

// abilities.tex "Protection Surge": "When they realize that an ally within
// 10m has been attacked, they can make a protection surge. This is a reaction
// surge that allows repositioning immediately to assist the ally." The
// table's rulings: the surge is made with the block, intercept or guard that
// repositions, the martyr's run, and its AP pay for anything after.
describe('the protection surge', () => {
  it('offers one who has learned it a block that runs onto the line, made with the surge, and nobody else', () => {
    const s = thrustAtAlly()
    const block = option(s, 'g', 'block (protection surge) with Wooden Shield (surge first)')
    expect(block).toMatchObject({ available: true, surge: 'protection' })
    expect(getAvailableActions(s, 'o').some((o) => o.draft.kind === 'block')).toBe(false)
  })

  it('is made as the block is declared, and the run puts the guardian where the strike meets their block', () => {
    const start = thrustAtAlly()
    const declared = declareReaction('g', option(start, 'g', 'block (protection surge) with Wooden Shield (surge first)')!.draft, newId)(start)
    expect(declared.characters.g.usedSurge).toBe('protection')
    expect(declared.characters.g.resources.AP).toBe(start.characters.g.resources.AP + getSurgeAP('protection')(start.characters.g))
    const s = takeStep(declared)
    expect(s.characters.g.resources.AP).toBeLessThan(declared.characters.g.resources.AP)
    const strike = getOpenAction(s)!
    expect(isOnProtectLine(s, strike as Parameters<typeof isOnProtectLine>[1], 'g', s.board!.placements.g)).toBe(true)
    expect(getDefendingReaction(s, strike)?.actorId).toBe('g')
  })

  it('is never made on its own', () => {
    const s = { ...onBoard({ g: [0, 0] }, shielded('g', ['protection-surge'])), inTurnCharacter: 'g' }
    expect(surge('g', 'protection')(s)).toBe(s)
  })

  it('reaches an ally within 10 m and no farther', () => {
    const at = (apart: number) => {
      const s = onBoard({ atk: [0, -1], ally: [0, 0], g: [apart, 0] }, fighter('atk'), fighter('ally'), { ...fighter('g', ['protection-surge']), usedSurge: 'protection' as const })
      return isProtectionGuard(s, 'g', strikeOn('ally'))
    }
    expect(at(PROTECTION_RANGE)).toBe(true)
    expect(at(PROTECTION_RANGE + 1)).toBe(false)
  })

  it('guards an ally against a shot from beside them, nearer the shooter', () => {
    let s = onBoard({ atk: [0, 0], ally: [-3, 0], g: [-3, 3] }, archer('atk'), fighter('ally'), shielded('g', ['protection-surge']))
    s = declareAction('atk', { kind: 'shoot', weaponKey: s.characters.atk.held[0].id, attack: 'shoot', variant: 'basic', ammoId: 'arrows' }, newId)(s)
    const start = commitAction(() => 5, newId)(setTarget('ally')(s))
    const guard = option(start, 'g', 'guard (protection surge) with Wooden Shield (surge first)')
    expect(guard).toMatchObject({ available: true, surge: 'protection' })
    const moved = takeStep(declareReaction('g', guard!.draft, newId)(start))
    expect(getAdjacentIds(moved, 'ally')).toContain('g')
    expect(getDefendingReaction(moved, getOpenAction(moved)!)?.actorId).toBe('g')
  })
})

function strikeOn(targetId: string) {
  return makeAction('strike', { id: 'x', actorId: 'atk', targetId })
}

// abilities.tex "Guardian's Vigor" II: "can reposition themselves a second
// time during the round after using protection surge".
describe("Guardian's Vigor", () => {
  const holding = (abilities: AbilityKey[]) => {
    const s = onBoard({ atk: [0, -1], ally: [0, 0], g: [2, 0] }, fighter('atk'), fighter('ally'), { ...fighter('g', abilities), usedSurge: 'protection' as const })
    return { ...s, protectionMoves: ['g'] }
  }

  it('lets the guardian reposition a second time in the round, and only with its second level', () => {
    expect(isProtectionGuard(holding(['protection-surge', 'guardian-s-vigor-1']), 'g', strikeOn('ally'))).toBe(false)
    expect(isProtectionGuard(holding(['protection-surge', 'guardian-s-vigor-1', 'guardian-s-vigor-2']), 'g', strikeOn('ally'))).toBe(true)
  })
})

// abilities.tex "Bulwark": "+1|2 to defend and reflex when making the
// protection surge to protect someone else": every defense and reflex once
// the surge is made (the table's ruling).
describe('Bulwark', () => {
  const edge = ABILITIES['bulwark-1'].recipes.find((r) => r.type === 'edge')
  const term = { label: 'Bulwark', value: edge && edge.type === 'edge' ? edge.hit : 0 }

  it('adds to the block the surge repositioned for', () => {
    const start = thrustAtAlly(shielded('g', ['protection-surge', 'bulwark-1']))
    const s = takeStep(declareReaction('g', option(start, 'g', 'block (protection surge) with Wooden Shield (surge first)')!.draft, newId)(start))
    expect(getDLTerms(s, getOpenAction(s)!)).toContainEqual(term)
  })

  it("adds to the guardian's own defense under the surge, and not before it is made", () => {
    const defend = (usedSurge: 'protection' | null) => {
      let s = onBoard({ atk: [0, 0], g: [1, 0] }, fighter('atk'), { ...shielded('g', ['protection-surge', 'bulwark-1']), usedSurge })
      const [row] = getAttackOptions(s.characters.atk, 'strike', true)
      s = declareAction('atk', { kind: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(s)
      s = commitAction(() => 5, newId)(setTarget('g')(s))
      const evade = getAvailableActions(s, 'g').find((o) => o.draft.kind === 'evade' && o.available)!
      const declared = declareReaction('g', evade.draft, newId)(s)
      return getDLTerms(declared, getOpenAction(declared)!)
    }
    expect(defend('protection')).toContainEqual(term)
    expect(defend(null)).not.toContainEqual(term)
  })
})

// abilities.tex "Rallying Guard": "Using protection surge automatically makes
// a rally".
describe('Rallying Guard', () => {
  it('rallies the guardian’s allies as the surge is made', () => {
    const start = thrustAtAlly(shielded('g', ['protection-surge', 'rallying-guard']))
    const s = declareReaction('g', option(start, 'g', 'block (protection surge) with Wooden Shield (surge first)')!.draft, newId)(start)
    expect(s.pressure.some((p) => p.from === 'g' && p.kind === 'rally' && p.target === 'ally')).toBe(true)
  })
})

// abilities.tex "Guardian": "Gains 1 XP each time they use their protection
// surge"; "Loses 1 XP whenever they refuse to use their protection surge and
// an ally takes tier 2 damage or higher".
describe('the Guardian attitudes', () => {
  it('pay for the surge made', () => {
    const start = thrustAtAlly()
    const s = declareReaction('g', option(start, 'g', 'block (protection surge) with Wooden Shield (surge first)')!.draft, newId)(start)
    expect(xp(s, 'g') - xp(start, 'g')).toBe(attitudeXP('protectionSurge'))
  })

  it('take for a surge let go by, once the ally is hurt badly enough', () => {
    const rolled = rollAction(() => MISS, newId)(thrustAtAlly())
    const strike = rolled.actions[rolled.landed.find((id) => rolled.actions[id].kind === 'strike') ?? getOpenAction(rolled)!.id]
    expect(strike.unprotectedBy).toEqual(['g'])
    const hurt = (tier: number) => ({ ...strike, results: [{ targetId: 'ally', outcome: OutcomeSchema.parse({ tier }), steps: [] }] })
    expect(xp(meetUnprotected(rolled, hurt(PROTECTION_FAILED_TIER)), 'g') - xp(rolled, 'g')).toBe(attitudeXP('refusedProtection'))
    expect(xp(meetUnprotected(rolled, hurt(PROTECTION_FAILED_TIER - 1)), 'g')).toBe(xp(rolled, 'g'))
  })
})
