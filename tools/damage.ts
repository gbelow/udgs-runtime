import { addInstance } from '../app/domain/instances'
import { board } from '../app/domain/bot/fixtures'
import { estimateAttacks, rankAttacks, type AttackEstimate, type BreakEstimate, type DefenseEstimate } from '../app/domain/bot/estimate'
import { buildFighter } from './lib/fighters'

// What each attack of one fighter would do to another, read off the real action
// pipeline by `domain/bot/estimate.ts`, the same estimate a bot weighs its
// attacks with: every attack the attacker can pay for and reach with, against
// every defense the target could answer with, over the attacker's die, the
// overflow of a hit (HOP) spent on whatever does the most. Attacks are listed
// best first by value (injury level plus equipment breakage) per cost, the target answering as it best can.
//
//   pnpm damage "<Attacker>" "<Defender>" [--distance n] [--aim location] [--sta-weight n] [--attack n] [--grid] [--json]
//
// A fighter is "<Catalog character>:<Weapon>[+<Offhand>]", as for `pnpm duel`.
// `--grid` adds a line for each value of the die against the target's best
// answer. `--sta-weight` is how many AP an STA is worth in the single cost.

function flag(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`)
}

function positional(args: string[]): string[] {
  const valued = new Set(['distance', 'aim', 'attack', 'sta-weight'])
  return args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && valued.has(args[i - 1].slice(2))))
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(4)
const num = (n: number | null, digits = 2) => (n === null ? '  -  ' : Number.isFinite(n) ? n.toFixed(digits) : 'inf')

function breakText(breaks: BreakEstimate[]): string {
  return breaks.length === 0 ? 'none' : breaks.map((b) => `${b.owner === 'foe' ? 'foe' : 'own'} ${b.kind} ${pct(b.odds).trim()}`).join(', ')
}

function defenseLine(d: DefenseEstimate, mark: string): string {
  const label = d.landings > 1 ? `${d.label} (and ${d.landings - 1} landing${d.landings > 2 ? 's' : ''} like it)` : d.label
  return `${mark} ${label.padEnd(46)} foe pays ${d.cost.AP} AP ${d.cost.STA} STA | hit ${pct(d.pHit)} graze ${pct(d.pGraze)} stun ${pct(d.pStun)} dead ${pct(d.pDead)} | E[IL] ${num(d.expectedIL)} (HOP unspent ${num(d.expectedILUnspent)}) | bleed ${num(d.expectedBleed)} | foe AP lost ${num(d.expectedAPLoss)} | HOP price ${num(d.expectedExtra.AP)} AP ${num(d.expectedExtra.STA)} STA | breaks ${breakText(d.breaks)} (${num(d.expectedBreakIL)} IL) | value ${num(d.value)}`
}

function dieLines(d: DefenseEstimate): string[] {
  return d.byDie.map(({ die, degree, score, DL, HOP, spent, extra, outcome }) => {
    const out = outcome && degree !== 'miss' ? ` | tier ${outcome.tier ?? '-'} IL ${outcome.IL} bleed ${outcome.bleed}${outcome.interruption !== 'none' ? ` ${outcome.interruption}` : ''}${outcome.dead ? ' DEAD' : ''} | arrived ${outcome.arrived.blunt} blunt ${outcome.arrived.cut} cut` : ''
    const bought = spent.length > 0 ? ` | HOP spent on ${spent.join(', ')}${extra.AP + extra.STA > 0 ? ` (+${extra.AP} AP +${extra.STA} STA)` : ''}` : ''
    return `        die ${String(die).padStart(3)}: score ${score} vs DL ${DL} → ${degree}${degree === 'hit' ? ` (HOP ${HOP})` : ''}${out}${bought}`
  })
}

function main(): void {
  const args = process.argv.slice(2)
  const [specA, specB] = positional(args)
  if (!specA || !specB) throw new Error('usage: pnpm damage "<Character>:<Weapon>[+<Offhand>]" "<Character>:<Weapon>[+<Offhand>]" [--distance n] [--aim location] [--sta-weight n] [--attack n] [--grid] [--json]')
  const distance = Number(flag(args, 'distance', '1'))
  const aim = has(args, 'aim') ? flag(args, 'aim', 'chest') : undefined
  const staWeight = Number(flag(args, 'sta-weight', '1'))
  const only = has(args, 'attack') ? Number(flag(args, 'attack', '0')) : null
  const grid = has(args, 'grid')

  let n = 0
  const newId = () => `s${++n}`
  const attacker = addInstance(buildFighter('a', specA, 'attacker'), newId, [])
  const defender = addInstance(buildFighter('b', specB, 'defender'), newId, [attacker.id])
  const state = board({ a: [0, 0], b: [distance, 0] }, attacker, defender)

  const ranked = rankAttacks(estimateAttacks(state, 'a', 'b', { aim, staWeight }))
  if (ranked.length === 0) throw new Error(`${specA} has no attack it can pay for that reaches ${specB} at ${distance} cell(s)`)

  if (has(args, 'json')) {
    const strip = (a: AttackEstimate) => ({ ...a, defenses: a.defenses.map((d) => ({ ...d, byDie: grid ? d.byDie : undefined })), guarded: { ...a.guarded, byDie: grid ? a.guarded.byDie : undefined } })
    console.log(JSON.stringify({ attacker: specA, defender: specB, distance, aim: aim ?? null, staWeight, attacks: ranked.map(strip) }, null, 2))
    return
  }

  const describe = (id: string) => `${state.characters[id].name} [${state.characters[id].held.map((i) => i.name).join(' + ') || 'bare hands'}; ${state.characters[id].worn?.name ?? 'no armor'}]`
  const lines = [`${describe('a')}  →  ${describe('b')}  (${distance} cell${distance === 1 ? '' : 's'}${aim ? `, aimed at ${aim}` : ''}; an STA counts as ${staWeight} AP)`, '', 'Best first by value (IL plus equipment breakage) per cost, the target answering as it best can:']
  ranked.forEach((a, i) => {
    lines.push(`  [${i}] ${a.label.padEnd(40)} costs ${a.totalCost.AP.toFixed(1)} AP ${a.totalCost.STA.toFixed(1)} STA | E[IL] ${num(a.expectedIL)} breakage ${num(a.expectedBreakIL)} value ${num(a.value)} | IL/AP ${num(a.ilPerAP)} IL/STA ${num(a.ilPerSTA)} IL/cost ${num(a.ilPerCost)} | answered by ${a.guarded.label}`)
  })
  ranked.forEach((a, i) => {
    if (only !== null && only !== i) return
    lines.push('', `[${i}] ${a.label} — ${a.cost.AP} AP, ${a.cost.STA} STA`)
    for (const d of a.defenses) lines.push(defenseLine(d, d === a.guarded ? '*' : ' '))
    if (grid) lines.push(...dieLines(a.guarded))
  })
  lines.push('', '* is the answer assumed (the one that leaves the attacker the least value). Breakage counts a weapon as a tier 3 injury and a shield as a tier 2 one (positive when it is the foe, negative when it is the attacker); armor is left out. E[IL] is per attack, capped at what the target has left before death, with HOP spent on whatever does the most; HOP price is the AP and STA that spend costs the attacker on top (assassinate, braced, hook).')
  console.log(lines.join('\n'))
}

main()
