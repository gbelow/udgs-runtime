import { describe, it, expect } from 'vitest'
import { SceneStateSchema, type SceneState } from '../types'
import { makeAction } from '../factories'
import { makeCampaignCharacter } from '../../factories'
import { grantAbility } from '../../character/commands/abilities'
import { ABILITIES, type AbilityKey } from '../../abilities'
import { getConvictionSlot } from '../../character/rules/requirements'
import { getThrowHappenings } from '../../character/rules/attitudes'
import { getDeathIL, getInjuryCapacity, hasAffliction } from '../../character/rules/afflictions'
import { getCharisma } from '../../character/rules/characteristics'
import { skillTermGetters } from '../../character/rules/skills'
import { sumTerms } from '../../character/rules/terms'
import { getSocialSayBar } from '../rules/social'
import { endCombat } from './endCombat'
import { continueRound, nextRound } from './nextRound'
import { inspire, leadershipRally } from './inspiringDeed'
import { getSocialCost } from '../rules/social'
import { rollMorale } from './morale'
import { meetAttackOnSurrendered } from './providence'
import { landSocial, rally } from './social'
import { updateCharacter } from './characters'

const slot = getConvictionSlot('Providentialism')!

// Providentialism adopted at level 0, and the abilities given.
function fighter(id: string, abilities: AbilityKey[] = []) {
  const base = abilities.reduce((acc, key) => grantAbility(key)(acc), makeCampaignCharacter({ name: id }))
  const trainables = { ...base.trainables, [slot]: { ...base.trainables[slot], name: 'Providentialism', value: 0, XP: 0 } }
  return { ...base, id, trainables }
}

// `a` and `ally` fight `b` and `foe`.
function inFight(abilities: AbilityKey[], extra: Partial<SceneState> = {}): SceneState {
  return {
    ...SceneStateSchema.parse({ round: 2 }),
    characters: { a: fighter('a', abilities), ally: fighter('ally', abilities), b: fighter('b'), foe: fighter('foe') },
    partyOf: { a: 'x', ally: 'x', b: 'y', foe: 'y' },
    ...extra,
  }
}

const xp = (s: SceneState, id: string) => s.characters[id].trainables[slot].XP
const attitudeXP = (event: string) => ABILITIES.justice.attitudes.find((a) => a.on.event === event)?.XP ?? 0

// abilities.tex "Justice": "Loses 4 XP if they attack someone who has
// surrendered. Loses 1 XP if anyone else on the team attacks someone who has
// surrendered."
describe('Justice', () => {
  const strike = (targetId: string) => makeAction('strike', { id: 's', actorId: 'a', targetId })

  it('holds an attack on a surrendered character against the attacker and, less, the team', () => {
    const state = inFight(['justice'], { surrendered: ['b'] })
    const after = meetAttackOnSurrendered(state, strike('b'))
    expect(xp(after, 'a') - xp(state, 'a')).toBe(attitudeXP('attackedSurrendered'))
    expect(xp(after, 'ally') - xp(state, 'ally')).toBe(attitudeXP('allyAttackedSurrendered'))
  })

  it('holds nothing against an attack on someone who has not surrendered', () => {
    const state = inFight(['justice'], { surrendered: ['b'] })
    expect(meetAttackOnSurrendered(state, strike('foe'))).toBe(state)
  })

  // abilities.tex "Justice": "Gains 2 XP at the end of a combat where
  // everyone that surrendered survives"
  describe('at the end of a combat', () => {
    const ended = (state: SceneState) => endCombat(() => 5)({ ...state, agreedToEnd: Object.keys(state.characters) })

    it('pays everyone when all who surrendered are alive', () => {
      const state = inFight(['justice'], { surrenderers: ['b'] })
      const after = ended(state)
      expect(after.round).toBe(0)
      expect(xp(after, 'a') - xp(state, 'a')).toBe(attitudeXP('surrendersSpared'))
      expect(xp(after, 'ally') - xp(state, 'ally')).toBe(attitudeXP('surrendersSpared'))
    })

    it('pays nothing when nobody surrendered', () => {
      const state = inFight(['justice'])
      expect(xp(ended(state), 'a')).toBe(xp(state, 'a'))
    })

    it('pays nothing when one who surrendered died', () => {
      const state = inFight(['justice'], { surrenderers: ['b'] })
      const dead = updateCharacter('b', (c) => ({ ...c, injuries: { ...c.injuries, injuryLevel: getDeathIL(c) } }))(state)
      expect(xp(ended(dead), 'a')).toBe(xp(state, 'a'))
    })
  })
})

// abilities.tex "Against the Odds": "Gains +1 AP in any round an opponent
// uses intimidation."
describe('Against the Odds', () => {
  const intimidate = makeAction('social', { id: 'i', actorId: 'b', say: 'intimidate' })
  const AP = (s: SceneState, id: string) => s.characters[id].resources.AP

  it('gives its holder the AP once in a round, however many intimidate', () => {
    const state = inFight(['against-the-odds'])
    const once = landSocial(state, intimidate)
    const twice = landSocial(once, makeAction('social', { id: 'j', actorId: 'foe', say: 'intimidate' }))
    expect(AP(once, 'a') - AP(state, 'a')).toBe(1)
    expect(AP(twice, 'a')).toBe(AP(once, 'a'))
  })

  it('gives nothing to one without it, nor for an ally’s intimidation', () => {
    const state = inFight([])
    expect(AP(landSocial(state, intimidate), 'a')).toBe(AP(state, 'a'))
    const held = inFight(['against-the-odds'])
    expect(AP(landSocial(held, makeAction('social', { id: 'k', actorId: 'ally', say: 'intimidate' })), 'a')).toBe(AP(held, 'a'))
  })
})

// abilities.tex "Inspiring Deed": "Rallies their team any time they roll a 9
// on the dice."
describe('Inspiring Deed', () => {
  const thrown = (die: number) => getThrowHappenings({ mode: 'normal', die, explodes: false, scored: null })
  const rallies = (s: SceneState) => s.pressure.filter((p) => p.from === 'a' && p.kind === 'rally')

  it('rallies the team on a 9, once in the round', () => {
    const once = inspire(inFight(['inspiring-deed']), 'a', thrown(9))
    expect(rallies(once).map((p) => p.target)).toEqual(['ally'])
    expect(inspire(once, 'a', thrown(9))).toBe(once)
  })

  it('rallies nobody on any other face, or without it', () => {
    expect(rallies(inspire(inFight(['inspiring-deed']), 'a', thrown(8)))).toEqual([])
    expect(rallies(inspire(inFight([]), 'a', thrown(9)))).toEqual([])
  })
})

// abilities.tex "Leadership": "+1 to all skills in a round when they rallied
// their team."
describe('Leadership', () => {
  const strike = (s: SceneState) => sumTerms(skillTermGetters.strike(s.characters.a, []))
  const bonus = ABILITIES.leadership.effect.flatMap((e) => (e.type === 'buff' && e.effect.target === 'skill:strike' ? [e.effect.value] : []))[0]

  it('lends its bonus once they have rallied, until the round change is over', () => {
    const state = inFight(['leadership'])
    const rallied = rally(state, 'a')
    expect(strike(rallied) - strike(state)).toBe(bonus)
    const over = continueRound(() => 5)({ ...rallied, roundStep: 'morale', morale: [] })
    expect(over.roundStep).toBeNull()
    expect(strike(over)).toBe(strike(state))
  })

  it('lends nothing to a rally without it', () => {
    const state = inFight([])
    expect(strike(rally(state, 'a'))).toBe(strike(state))
  })

  // "you can decide to use rally after everyone has rolled": at the round
  // change, once every morale test is made, for the price of a rally
  describe('at the round change', () => {
    const fresh = inFight(['leadership'], { roundStep: 'morale', morale: [{ id: 'b', roll: null, optional: false }] })
    // the premise: the holder has AP to spend
    const waiting = updateCharacter('a', (c) => ({ ...c, resources: { ...c.resources, AP: 12 } }))(fresh)
    const rolled = rollMorale('b', 'normal', true, () => 5)(waiting)

    it('is closed while a morale test is still to be made', () => {
      expect(leadershipRally('a')(waiting)).toBe(waiting)
    })

    it('rallies the team for the rally’s price once they are all made', () => {
      const after = leadershipRally('a')(rolled)
      expect(after.characters.a.resources.AP).toBe(rolled.characters.a.resources.AP - getSocialCost(rolled.characters.a, 'rally').AP)
      expect(after.pressure.some((p) => p.from === 'a' && p.kind === 'rally' && p.target === 'ally')).toBe(true)
      expect(leadershipRally('a')(after)).toBe(after)
    })

    it('lends its bonus to the round that begins, and no further', () => {
      const after = leadershipRally('a')(rolled)
      const begun = continueRound(() => 5)(after)
      expect(begun.roundStep).toBeNull()
      expect(strike(begun) - strike(inFight(['leadership']))).toBe(bonus)
      const over = continueRound(() => 5)({ ...begun, roundStep: 'morale', morale: [] })
      expect(strike(over)).toBe(strike(inFight(['leadership'])))
    })
  })
})

// abilities.tex "Mercy": "Enemies that trigger their limit stress action
// after being intimidated by the character are compelled to surrender until
// the end of the round."
describe('Mercy', () => {
  const MISS = 1
  // `a` intimidated `b` in the round before; `b` is called to its morale test
  const called = (abilities: AbilityKey[]) => inFight(abilities, {
    roundStep: 'morale',
    morale: [{ id: 'b', roll: null, optional: false }],
    pressure: [{ round: 1, from: 'a', target: 'b', kind: 'intimidate', value: 9 }],
  })

  it('compels the enemy whose limit stress action the intimidation activated to surrender, in its place', () => {
    const after = rollMorale('b', 'normal', true, () => MISS)(called(['mercy']))
    expect(after.morale[0].roll?.limitStress).toBe(false)
    expect(after.surrendered).toContain('b')
    expect(after.compelledSurrender).toContain('b')
    expect(after.compulsions.some((t) => t.id === 'b')).toBe(false)
    expect(getSocialSayBar(after, after.characters.b, 'unsurrender')).not.toBeNull()
  })

  it('leaves the limit stress action alone without it', () => {
    const after = rollMorale('b', 'normal', true, () => MISS)(called([]))
    expect(after.morale[0].roll?.limitStress).toBe(true)
    expect(after.surrendered).toEqual([])
  })

  // abilities.tex "Mercy": "until the end of the round", whatever the morale
  // test after it came to
  it('keeps them surrendered through the round, and lifts it, flag and all, when the round ends', () => {
    const compelled = rollMorale('b', 'normal', true, () => MISS)(called(['mercy']))
    const quiet = { ...compelled, morale: [], roundStep: null, inTurnCharacter: '', pressure: [] }
    const ended = nextRound(() => 5)(quiet)
    expect(ended.round).toBe(quiet.round + 1)
    expect(ended.compelledSurrender).toEqual([])
    expect(ended.surrendered).not.toContain('b')
  })
})

// abilities.tex "Oathbound": "Gains +1 bonus to Charisma. A hit or crit in the
// morale test prevents the character from being immobile by shock or IL."
describe('Oathbound', () => {
  const MISS = 1
  const HIT = 10
  // the premise: an immobile character takes no morale test (combat.tex "Out
  // of the fight"), so the test is made one point under injury capacity
  const called = () => {
    const state = inFight(['oathbound'], { roundStep: 'morale', morale: [{ id: 'a', roll: null, optional: false }] })
    return updateCharacter('a', (c) => ({ ...c, injuries: { ...c.injuries, injuryLevel: getInjuryCapacity(c) - 1 } }))(state)
  }
  // the blow in the round that takes them to injury capacity
  const struck = (s: SceneState) => updateCharacter('a', (c) => ({ ...c, injuries: { ...c.injuries, injuryLevel: getInjuryCapacity(c) } }))(s)
  const immobile = (s: SceneState) => hasAffliction(s.characters.a, 'immobile')

  it('keeps a hit or a crit from collapsing at injury capacity, for the round', () => {
    const steeled = struck(rollMorale('a', 'normal', true, () => HIT)(called()))
    expect(steeled.characters.a.steeled).toBe(true)
    expect(immobile(steeled)).toBe(false)
  })

  it('does nothing after a miss', () => {
    const missed = struck(rollMorale('a', 'normal', true, () => MISS)(called()))
    expect(missed.characters.a.steeled).toBe(false)
    expect(immobile(missed)).toBe(true)
  })

  it('is over with the round', () => {
    const steeled = struck(rollMorale('a', 'normal', true, () => HIT)(called()))
    const ended = nextRound(() => 5)({ ...steeled, morale: [], roundStep: null, inTurnCharacter: '' })
    expect(ended.characters.a.steeled).toBe(false)
    expect(immobile(ended)).toBe(true)
  })

  it('adds its Charisma', () => {
    const bonus = ABILITIES.oathbound.effect.flatMap((e) => (e.type === 'buff' && e.effect.target === 'characteristic:charisma' ? [e.effect.value] : []))[0]
    expect(getCharisma(inFight(['oathbound']).characters.a) - getCharisma(inFight([]).characters.a)).toBe(bonus)
  })
})
