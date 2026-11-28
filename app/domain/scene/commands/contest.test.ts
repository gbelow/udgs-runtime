import { describe, expect, it } from 'vitest'
import type { SceneState } from '../types'
import { board, fighter, spearman } from '../fixtures'
import { getAttackOptions } from '../rules/attack'
import { getOpenAction } from '../rules/log'
import { getContenders, getEndTurnBar, getSurgeTurnBar, isContestDue } from '../rules/turn'
import { isContestPending } from '../rules/contest'
import { commitAction, declareAction, setTarget } from './action'
import { readClick } from './click'
import { closeContest, endTurn, setContestDecideSeconds, setContestSeconds, settleContest, startTurn, thinkContest, toggleContest } from './turn'

let n = 0
const newId = () => `c${++n}`
const five = () => 5

const fight = () => board({ a: [0, 0], b: [1, 0], c: [0, 3] }, spearman('a'), fighter('b'), fighter('c'))
const begun = () => startTurn('a')(fight())

function strikeBy(id: string, at: string, state: SceneState): SceneState {
  const [row] = getAttackOptions(state.characters[id], 'strike', true)
  return commitAction(five, newId)(setTarget(at)(declareAction(id, { kind: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(state)))
}

// The table's rulings: nothing is committed while the turn may be contested; a
// player asks for the time to say with whom, then says it or drops it; more
// than one of theirs may contest; the GM sets the time, or none.
describe('the time to contest a turn', () => {
  it('lets nothing be committed in the turn until it is over', () => {
    const s = begun()
    expect(isContestPending(s)).toBe(true)
    expect(getOpenAction(strikeBy('a', 'b', s))?.step).toBe('define')
    expect(getEndTurnBar(s)).not.toBeNull()
    expect(getSurgeTurnBar(s, 'a', 'combat')).not.toBeNull()
    expect(endTurn(s)).toBe(s)
    const over = closeContest(five)(s)
    expect(isContestPending(over)).toBe(false)
    expect(getOpenAction(strikeBy('a', 'b', over))?.step).not.toBe('define')
  })

  // the user's ruling (2026-11-28): asked for, the contest is made with whoever their player clicks on the board
  it('takes one of theirs a click picks while their player thinks about it, and lets them go on another click', () => {
    const click = (s: SceneState) => {
      const read = readClick(s, { on: 'token', id: 'b' }, { brush: null, reposition: false, selected: null, newId })
      if (!('apply' in read)) throw new Error('a click on one of theirs while they think is no pick')
      return read.apply(s)
    }
    const picked = click(thinkContest(['b', 'c'])(begun()))
    expect(picked.contenders).toEqual(['b'])
    expect(click(picked).contenders).toEqual([])
  })

  it('is held open past its end by whoever is thinking about it, and by nobody once they have decided', () => {
    const thinking = thinkContest(['b', 'c'])(begun())
    expect(isContestDue(thinking, ['b', 'c'], thinking.contestSeconds, 0)).toBe(false)
    const dropped = settleContest(['b', 'c'], false)(thinking)
    expect(isContestDue(dropped, ['b', 'c'], 0, 0)).toBe(true)
    expect(getContenders(dropped)).toEqual([])
  })

  it('is held open no longer than the table gives to decide, with what was picked by then standing', () => {
    const s = toggleContest('b')(thinkContest(['b', 'c'])(begun()))
    expect(isContestDue(s, ['b', 'c'], s.contestDecideSeconds, s.contestDecideSeconds)).toBe(true)
    expect(closeContest(five)(s).lastContest?.rolls.map((r) => r.id)).toEqual(['a', 'b'])
    const unlimited = setContestDecideSeconds(0)(s)
    expect(isContestDue(unlimited, ['b', 'c'], 1000, 1000)).toBe(false)
  })

  it('closes before its end once everyone waited on has decided, and not before', () => {
    const s = settleContest(['b'], false)(begun())
    expect(isContestDue(s, ['b', 'c'], 0, null)).toBe(false)
    expect(isContestDue(s, ['b', 'c'], s.contestSeconds, null)).toBe(true)
    expect(isContestDue(settleContest(['c'], false)(s), ['b', 'c'], 0, null)).toBe(true)
  })

  it('rolls for everyone picked, and takes what the holder had begun to declare from them with the turn', () => {
    const drafted = strikeBy('a', 'b', begun())
    const asked = settleContest(['b', 'c'], true)(toggleContest('c')(toggleContest('b')(thinkContest(['b', 'c'])(drafted))))
    const dice = [1, 10, 2]
    const rolled = closeContest(() => dice.shift() ?? 1)(asked)
    expect(rolled.lastContest?.rolls.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(rolled.inTurnCharacter).not.toBe('a')
    expect(getOpenAction(rolled)).toBeNull()
  })

  it('is not opened at a table that gives it no time', () => {
    const s = startTurn('a')(setContestSeconds(0)(fight()))
    expect(isContestPending(s)).toBe(false)
    expect(getOpenAction(strikeBy('a', 'b', s))?.step).not.toBe('define')
  })
})
