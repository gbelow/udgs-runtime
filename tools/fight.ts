import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SceneState } from '../app/domain/scene/types'
import type { CampaignCharacter } from '../app/domain/types'
import { rollD10, seededRng, type Dice } from '../app/domain/play/dice'
import * as fixtures from '../app/domain/bot/fixtures'
import { buildFighter } from './lib/fighters'
import { stepBot } from '../app/domain/bot/step'
import { applyMove } from '../app/domain/bot/move'
import { getLiveFoes, getTuning, type Party, type Tuning } from '../app/domain/bot/party'
import type { Decision, OptionScore } from '../app/domain/bot/trace'
import { getNextRoundBar } from '../app/domain/scene/rules/turn'
import { nextRound } from '../app/domain/scene/commands/nextRound'
import { getFightLogLines } from '../app/domain/scene/projections/episode'
import { getLanded } from '../app/domain/scene/rules/log'
import { getFightName } from '../app/domain/scene/rules/fighters'
import { getSTA } from '../app/domain/character/rules/characteristics'
import { isDead } from '../app/domain/character/rules/afflictions'

// A fight the bots play on both sides, written out as a report: every decision
// a bot made with each option it weighed, the parts of its value and how long
// it took, what each move came to on the table, and how everyone stood at the
// end of each round.
//
//   pnpm fight <side A> vs <side B> [--seed n] [--rounds n] [--distance n] [--out name] [--tune key=value,...]
//
// A side is one or more fighters: a bot fixture by name (spearman, archer,
// fighter, crossbowman, brawler, warden, ...) or a catalog character with its
// gear ("Human Warrior:Longsword", "Human Warrior:Short Spear+Wooden Shield").
//
//   pnpm fight spearman archer vs fighter archer --seed 3
//
// The report goes to reports/fight/<out>.md (by default the fighters' names).

type Args = { sides: [string[], string[]]; seed: number; rounds: number; distance: number; out: string | null; tune: Partial<Tuning> }

function parse(argv: string[]): Args {
  const flags = new Map<string, string>()
  const words: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags.set(argv[i].slice(2), argv[++i] ?? '')
    else words.push(argv[i])
  }
  const split = words.indexOf('vs')
  if (split <= 0 || split === words.length - 1) throw new Error('usage: pnpm fight <side A> vs <side B> [--seed n] [--rounds n] [--distance n] [--out name] [--tune key=value,...]')
  const tune = Object.fromEntries((flags.get('tune') ?? '').split(',').filter(Boolean).map((pair) => {
    const [key, value] = pair.split('=')
    return [key, Number(value)]
  }))
  return {
    sides: [words.slice(0, split), words.slice(split + 1)],
    seed: Number(flags.get('seed') ?? 1),
    rounds: Number(flags.get('rounds') ?? 5),
    distance: Number(flags.get('distance') ?? 20),
    out: flags.get('out') ?? null,
    tune,
  }
}

const FIXTURES = fixtures as unknown as Record<string, unknown>

function makeFighter(spec: string, id: string, label: string): CampaignCharacter {
  const fixture = FIXTURES[spec]
  if (typeof fixture === 'function' && spec !== 'board') return { ...(fixture as (id: string) => CampaignCharacter)(id), name: `${label} ${spec}` }
  return buildFighter(id, spec, label)
}

// A value as a signed number to two places, a dot for nothing.
const signed = (x: number) => (Math.abs(x) < 0.005 ? '·' : `${x > 0 ? '+' : '-'}${Math.abs(x).toFixed(2)}`)

// A markdown table whose columns line up in the source too, numbers to the
// right.
function table(header: string[], rows: string[][], right: boolean[]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (cells: string[]) => `| ${cells.map((c, i) => (right[i] ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join(' | ')} |`
  const rule = `|${widths.map((w, i) => (right[i] ? `${'-'.repeat(w + 1)}:` : `${'-'.repeat(w + 2)}`)).join('|')}|`
  return [line(header), rule, ...rows.map(line), '']
}

function standingTable(state: SceneState, ids: readonly string[]): string[] {
  const rows = ids.map((id) => {
    const c = state.characters[id]
    const cell = state.board?.placements[id]?.cell
    return [getFightName(state, id), `${c.injuries.injuryLevel}/${c.injuries.deathThreshold}`, isDead(c) ? 'dead' : '', String(c.resources.AP), `${c.resources.STA}/${getSTA(c)}`, cell ? `${cell.q},${cell.r}` : '-']
  })
  return table(['fighter', 'IL', 'state', 'AP', 'STA', 'cell'], rows, [false, true, false, true, true, true])
}

// The parts of an option's value, as the report names them; engage counts
// against it.
const PARTS = [
  ['wounds', (o: OptionScore) => o.wounds],
  ['potential', (o: OptionScore) => o.potential],
  ['immediate', (o: OptionScore) => o.immediate],
  ['engage', (o: OptionScore) => -o.engage],
  ['resources', (o: OptionScore) => o.resources],
  ['exchange', (o: OptionScore) => o.exchange],
  ['waiting', (o: OptionScore) => o.waiting],
] as const

function decisionLines(state: SceneState, d: Decision, ms: number): string[] {
  const chosen = d.options[d.chosen]
  const parts = PARTS.filter(([, of]) => d.options.some((o) => Math.abs(of(o)) >= 0.005))
  const rows = d.options.map((o, i) => [i === d.chosen ? '▶' : '', o.label, signed(o.value), ...parts.map(([, of]) => signed(of(o)))])
  return [
    `**${getFightName(state, d.actorId)}** ${d.kind === 'turn' ? 'takes its turn' : 'answers'}: ${chosen?.label ?? 'nothing'} *(${ms.toFixed(0)} ms, ${d.options.length} options)*`,
    '',
    ...table(['', 'option', 'value', ...parts.map(([name]) => name)], rows, [false, false, true, ...parts.map(() => true)]),
  ]
}

function main(): void {
  const args = parse(process.argv.slice(2))
  const rng = seededRng(args.seed)
  const dice: Dice = (explodes) => rollD10(explodes, rng)
  let ids = 0
  const newId = () => `x${++ids}`

  const characters: CampaignCharacter[] = []
  const placements: Record<string, [number, number]> = {}
  const members: [string[], string[]] = [[], []]
  args.sides.forEach((specs, side) => specs.forEach((spec, k) => {
    const id = `${side === 0 ? 'a' : 'b'}${k + 1}`
    characters.push(makeFighter(spec, id, `${side === 0 ? 'A' : 'B'}${k + 1}`))
    placements[id] = [side === 0 ? 0 : args.distance, k]
    members[side].push(id)
  }))
  let state = fixtures.board(placements, ...characters)
  const parties: Party[] = members.map((m) => ({ members: m, tuning: args.tune }))
  const everyone = [...members[0], ...members[1]]

  const lines: string[] = [
    `# Fight: ${args.sides[0].join(', ')} vs ${args.sides[1].join(', ')}`,
    '',
    `Seed ${args.seed}, ${args.distance} cells apart, at most ${args.rounds} rounds. Tuning: \`${JSON.stringify(getTuning(parties[0]))}\``,
    '',
    'Each option\'s value is the sum of its parts, a dot for nothing; a part that is nothing for every option is left out. See `app/domain/bot/value.ts`.',
    '',
    ...standingTable(state, everyone),
  ]

  const times: number[] = []
  let landed = 0
  let ended = ''
  const started = performance.now()
  for (let round = 0; round < args.rounds && !ended; round++) {
    lines.push(`## Round ${state.round}`, '')
    for (let step = 0; step < 500; step++) {
      const decisions: Decision[] = []
      const t0 = performance.now()
      const move = stepBot(state, parties, dice, newId, (d) => decisions.push(d))
      const ms = performance.now() - t0
      if (!move) break
      if (decisions.length > 0) {
        times.push(ms)
        decisions.forEach((d) => lines.push(...decisionLines(state, d, ms / decisions.length)))
      }
      state = applyMove(state, move, dice, newId)
      const now = getLanded(state).length
      if (now > landed) {
        lines.push(...getFightLogLines(state, landed).map((l) => `> ${l.replace(/^round \d+ · /, '').replace(/ T(\d+)/g, ' (injury tier $1)')}  `), '')
        landed = now
      }
    }
    lines.push('End of the round:', '', ...standingTable(state, everyone))
    const fallen = parties.find((p) => getLiveFoes(state, p).length === 0)
    if (fallen) ended = `Side ${parties.indexOf(fallen) === 0 ? 'A' : 'B'} wins in round ${state.round}.`
    else if (getNextRoundBar(state) !== null) ended = `The round cannot pass: ${JSON.stringify(getNextRoundBar(state))}.`
    else state = nextRound(dice)(state)
  }

  const total = performance.now() - started
  const sorted = [...times].sort((a, b) => a - b)
  lines.push('## Summary', '', ended || `No side fell in ${args.rounds} rounds.`, '',
    `${times.length} decision steps in ${(total / 1000).toFixed(1)} s; per step: median ${(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(0)} ms, slowest ${(sorted.at(-1) ?? 0).toFixed(0)} ms.`, '')

  const name = args.out ?? `${args.sides[0].join('-')}-vs-${args.sides[1].join('-')}-seed${args.seed}`.replace(/[^\w.-]+/g, '_')
  const dir = path.join(process.cwd(), 'reports', 'fight')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.md`)
  writeFileSync(file, lines.join('\n'))
  console.log(`${ended || `No side fell in ${args.rounds} rounds.`} ${times.length} decision steps in ${(total / 1000).toFixed(1)} s.\n${file}`)
}

main(); process.on("exit",()=>{const g=(globalThis as any).__p;const T=g.triples;delete g.triples;console.log(JSON.stringify(g));const multi=Object.entries(T).filter(([k,v]:any)=>v.length>1);console.log("triples",Object.keys(T).length,"with repeats",multi.length);const [k,v]:any=multi.sort((a:any,b:any)=>b[1].length-a[1].length)[0]??[];if(v){console.log(k,v.length);const a=JSON.parse(v[0].slice(v[0].indexOf(" ")+1)),b=JSON.parse(v[1].slice(v[1].indexOf(" ")+1));const diff=(x:any,y:any,p:string):void=>{if(JSON.stringify(x)===JSON.stringify(y))return;if(x&&y&&typeof x==="object"&&typeof y==="object"){for(const kk of new Set([...Object.keys(x),...Object.keys(y)]))diff(x[kk],y[kk],p+"."+kk)}else console.log(p,JSON.stringify(x)?.slice(0,200),"=>",JSON.stringify(y)?.slice(0,200))};diff(a,b,"")}}) //PERFPROBE
