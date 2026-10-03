import type { ActionKind } from '../../app/domain/combat/types'
import type { Simulation } from '../../app/domain/bot/simulate'
import { findParty, type Party } from '../../app/domain/bot/party'

// Reads simulations into markdown for a person to look at. Nothing here is
// asserted on: it is the fights, laid out so they can be read against the book.

export type Run = { seed: number; sim: Simulation }

const ATTACKS: ActionKind[] = ['strike', 'shoot']

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

function pct(n: number, of: number): string {
  return of === 0 ? '–' : `${((100 * n) / of).toFixed(0)}%`
}

function side(parties: Party[], labels: string[], id: string): string {
  const party = findParty(parties, id)
  return party ? labels[parties.indexOf(party)] : 'unmanaged'
}

export function renderSummary(name: string, about: string, runs: Run[], parties: Party[], labels: string[]): string {
  const lines: string[] = [`# ${name}`, '', `${about}. ${runs.length} fights, seeds ${runs[0].seed}–${runs[runs.length - 1].seed}.`, '']

  const wins = labels.map((_, i) => runs.filter((r) => r.sim.winner === i).length)
  const none = runs.filter((r) => r.sim.ending === 'won' && r.sim.winner === null).length
  const capped = runs.filter((r) => r.sim.ending === 'round cap').length
  const stalled = runs.filter((r) => r.sim.ending === 'stalled').length
  const rounds = runs.map((r) => r.sim.rounds)
  lines.push('## Results', '', '| | fights | share |', '|---|---|---|')
  labels.forEach((l, i) => lines.push(`| ${l} wins | ${wins[i]} | ${pct(wins[i], runs.length)} |`))
  lines.push(`| both fell | ${none} | ${pct(none, runs.length)} |`, `| round cap | ${capped} | ${pct(capped, runs.length)} |`, `| stalled | ${stalled} | ${pct(stalled, runs.length)} |`, '')
  lines.push(`Rounds to finish: mean ${mean(rounds).toFixed(1)}, min ${Math.min(...rounds)}, max ${Math.max(...rounds)}.`, '')

  lines.push('## What each side did, per fight', '', '| side | actions | strikes | shots | moves | attack hit rate |', '|---|---|---|---|---|---|')
  for (const label of [...labels, 'unmanaged']) {
    const per = runs.map((r) => r.sim.log.filter((a) => side(parties, labels, a.actorId) === label))
    if (per.every((l) => l.length === 0)) continue
    const count = (kind: ActionKind) => mean(per.map((l) => l.filter((a) => a.kind === kind).length)).toFixed(1)
    const attacks = per.flatMap((l) => l.filter((a) => ATTACKS.includes(a.kind)))
    const hits = attacks.filter((a) => a.report.roll && a.report.roll.degree !== 'miss').length
    lines.push(`| ${label} | ${mean(per.map((l) => l.length)).toFixed(1)} | ${count('strike')} | ${count('shoot')} | ${count('move')} | ${pct(hits, attacks.length)} |`)
  }
  lines.push('')

  const idle = runs.filter((r) => r.sim.log.length === 0).length
  const odd = runs.find((r) => r.sim.ending !== 'won')
  lines.push('## Worth a look', '')
  lines.push(`- fights where nothing landed at all: ${idle}`, `- fights that stalled or hit the round cap: ${stalled + capped}${odd ? ` (first: seed ${odd.seed})` : ''}`, '')
  return lines.join('\n')
}

export function renderLog(run: Run, parties: Party[], labels: string[]): string {
  const { sim, seed } = run
  const lines: string[] = [`## Fight log, seed ${seed}`, '', `Ended: ${sim.ending}${sim.winner !== null ? `, ${labels[sim.winner]} won` : ''}${sim.stalledOn ? ` (${sim.stalledOn})` : ''} after ${sim.rounds} rounds.`, '']
  let round = 0
  for (const { round: r, report, actorId } of sim.log) {
    if (r !== round) {
      round = r
      lines.push(`### Round ${r}`, '')
    }
    const roll = report.roll ? ` — die ${report.roll.die}, ${report.roll.score} vs DL ${report.roll.DL}: **${report.roll.degree}**` : ''
    const injuries = report.outcomes.map(({ target, outcome }) => outcome.stopped ? `${target}: stopped` : `${target}: ${outcome.wound ? `${outcome.wound.name} (${outcome.wound.part.name})` : 'no injury'}, IL +${outcome.IL}${outcome.dead ? ', dead' : ''}`)
    const effects = [...injuries, ...report.notes.map((n) => `${n.target}: ${n.text}`)]
    lines.push(`- ${report.actor} (${side(parties, labels, actorId)}) · ${report.label}${roll}${effects.length > 0 ? ` → ${effects.join('; ')}` : ''}`)
  }
  lines.push('')
  return lines.join('\n')
}
