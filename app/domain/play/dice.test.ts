import { describe, expect, it } from 'vitest'
import { ROLL_MODES, readD10, seededRng } from './dice'
import { throwCall, type DieCall } from './calls'

const call = (mode: DieCall['mode'], explodes: boolean): DieCall =>
  ({ id: 'c', roller: 'a', label: '', explodes, mode, test: null, die: null, source: 'screen' })

const throws = function* () {
  for (const mode of ROLL_MODES) for (const explodes of [false, true]) for (let seed = 0; seed < 300; seed++)
    yield { mode, explodes, thrown: throwCall(call(mode, explodes), seededRng(seed)) }
}

describe('the dice tray', () => {
  // play.tex "Safe and risky tests": both dice are thrown in full and only then
  // compared, so the tray throws them as a pair, and the die is the kept one.
  it('throws a pair for a safe or risky test, and the die read is the set kept', () => {
    for (const { mode, thrown } of throws()) {
      for (const round of thrown.rounds) expect(round.length).toBe(mode === 'normal' ? 1 : 2)
      expect(readD10(thrown.rounds.at(-1)![thrown.kept])).toBe(thrown.die)
    }
  })

  // play.tex "Exploding die": a d10 reads 0 to 9; only a 9 or a 0 of a test
  // that explodes adds d6s, and they go on only while a d6 shows 6.
  it('throws only the dice the book calls for', () => {
    for (const { explodes, thrown } of throws()) {
      for (const { d10, d6s } of thrown.rounds.flat()) {
        expect(d10).toBeGreaterThanOrEqual(0)
        expect(d10).toBeLessThanOrEqual(9)
        if (!explodes || (d10 !== 0 && d10 !== 9)) expect(d6s).toEqual([])
        else {
          expect(d6s.length).toBeGreaterThan(0)
          d6s.forEach((d6, i) => expect(d6 === 6).toBe(i < d6s.length - 1))
        }
      }
    }
  })
})
