import type { SceneState } from '../scene/types'
import { isDead } from '../character/rules/afflictions'
import { run, type RunEnd, type Seat } from './seat'
import type { Box } from './decision'
import { isDown } from './table'
import { getEveryone, getPanelLeaks } from './leaks'

// Two boxes played against each other at a fight nobody runs as GM, to tell
// whether one plays better than the other. Each seed is played twice, the
// boxes trading sides, so that what a side's start is worth falls on both;
// every matchup is played on the same seeds, so two boxes measured against a
// third meet the same dice. Nothing here decides anything: it plays the
// fights (`playFight`) and counts them (`tally`).

export type Matchup = { start: SceneState; sides: [readonly string[], readonly string[]]; boxes: [Box, Box] }

// One fight, told from the first box's side: whether it won, lost or drew, or
// the fight broke (stalled, a decision refused, out of steps, or an offer
// naming someone the seat does not see), which is a fault, not
// a result.
export type Fight = {
  seed: number
  swapped: boolean
  result: 'win' | 'loss' | 'draw' | 'broken'
  end: RunEnd
  rounds: number
  // the first box's characters and the second's that went down, and died
  down: [number, number]
  dead: [number, number]
  // why it broke, when it did
  faults: string[]
}

const standing = (state: SceneState, ids: readonly string[]) => ids.filter((id) => !isDown(state, id) && !state.surrendered.includes(id))

export function playFight({ start, sides, boxes }: Matchup, seed: number, swapped: boolean, maxRounds = 30): Fight {
  const everyone = getEveryone(start)
  const leaks: string[] = []
  // each box watched for an offer naming someone its seat does not see
  const box = (i: 0 | 1): Box => {
    const inner = boxes[swapped ? 1 - i : i]
    const watched: Box = (input) => {
      leaks.push(...getPanelLeaks(input, everyone))
      return inner(input)
    }
    watched.remembers = inner.remembers
    return watched
  }
  const seats: Seat[] = [{ id: 'red', members: sides[0], box: box(0) }, { id: 'blue', members: sides[1], box: box(1) }]
  const played = run(start, seats, { seed, maxRounds })
  const { state } = played
  // [the first box's characters, the second's]
  const of: [readonly string[], readonly string[]] = swapped ? [sides[1], sides[0]] : [sides[0], sides[1]]
  const faults = [
    ...[...new Set(leaks)],
    ...played.log.filter((e) => e.refused).map((e) => `${e.by}: ${e.why}: ${e.refused}`),
    ...(played.end === 'stalled' ? [`stalled, waiting on ${JSON.stringify(played.stalled)}`] : []),
    // the cap reached before the last round: the seats pressed on without the
    // fight getting anywhere
    ...(played.end === 'cap' && played.rounds <= maxRounds ? [`ran out of steps in round ${played.rounds}`] : []),
  ]
  const left = of.map((ids) => standing(state, ids).length)
  const result = faults.length > 0 ? 'broken' : played.end !== 'ended' ? 'draw' : left[0] > 0 && left[1] === 0 ? 'win' : left[1] > 0 && left[0] === 0 ? 'loss' : 'draw'
  const count = (ids: readonly string[], f: (id: string) => boolean) => ids.filter(f).length
  return {
    seed,
    swapped,
    result,
    end: played.end,
    rounds: played.rounds,
    down: [count(of[0], (id) => isDown(state, id)), count(of[1], (id) => isDown(state, id))],
    dead: [count(of[0], (id) => !!state.characters[id] && isDead(state.characters[id])), count(of[1], (id) => !!state.characters[id] && isDead(state.characters[id]))],
    faults,
  }
}

export type Tally = {
  fights: number
  wins: number
  losses: number
  draws: number
  broken: number
  // the first box's score, a draw counted half, over the fights not broken,
  // with its 95% interval (Wilson)
  score: number
  low: number
  high: number
  rounds: number
}

export function tally(fights: readonly Fight[]): Tally {
  const n = (r: Fight['result']) => fights.filter((f) => f.result === r).length
  const wins = n('win'), losses = n('loss'), draws = n('draw'), broken = n('broken')
  const played = wins + losses + draws
  const score = played ? (wins + draws / 2) / played : 0
  const [low, high] = wilson(score, played)
  const kept = fights.filter((f) => f.result !== 'broken')
  return { fights: fights.length, wins, losses, draws, broken, score, low, high, rounds: kept.length ? kept.reduce((a, f) => a + f.rounds, 0) / kept.length : 0 }
}

function wilson(p: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1]
  const d = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}
