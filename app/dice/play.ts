import type { TrayThrow } from '../domain/play/calls'
import type { DiceTray } from './tray'

export type TrayStage = 'fling' | 'rolling' | 'draw' | 'exploding' | 'done'

// A test's throw played out in the tray: each round's d10s flung by hand (the
// first) or thrown again for a draw, then every d6 they exploded into, one
// throw for each d6 the chain goes on to; the set the test keeps is left
// standing out at the end. Resolves false if `stopped` before the end.
export async function playThrow(tray: DiceTray, thrown: TrayThrow, stage: (s: TrayStage) => void, stopped: () => boolean): Promise<boolean> {
  for (const [r, round] of thrown.rounds.entries()) {
    tray.clear()
    const d10s = round.map((s, tag) => ({ kind: 'd10' as const, value: s.d10, tag }))
    let fling = null
    if (r === 0) {
      stage('fling')
      fling = await tray.hold(d10s)
    }
    if (stopped()) return false
    stage('rolling')
    await tray.throw(d10s, fling)
    const chain = Math.max(0, ...round.map((s) => s.d6s.length))
    for (let k = 0; k < chain; k++) {
      if (stopped()) return false
      stage('exploding')
      await pause(350)
      await tray.throw(round.flatMap((s, tag) => (k < s.d6s.length ? [{ kind: 'd6' as const, value: s.d6s[k], tag }] : [])), null)
    }
    if (r < thrown.rounds.length - 1) {
      stage('draw')
      await pause(900)
    }
  }
  if (stopped()) return false
  if (thrown.rounds.at(-1)!.length > 1) tray.keepOnly(thrown.kept)
  stage('done')
  return true
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
