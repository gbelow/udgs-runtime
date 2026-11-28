import { DEGREES, type Degree } from '../../types'
import type { Action, Change, EditEntry, SceneState } from '../types'
import { getFightName } from '../rules/fighters'
import { getLanded, getAction } from '../rules/log'
import { isAttackAction } from '../rules/actionCatalog'
import { isVoided } from '../rules/opportunity'
import { ROUND_START_CAUSES } from '../rules/roundChange'
import { TEND_AFTER_FIGHT_CAUSE } from '../rules/fight'

// What the fight came to for each who was in it, read off the log once it is
// over (or at any point of it): the damage and IL each dealt and took, and to
// and from whom; the IL each bleed caused, credited to whoever put that bleed
// on (a bleed is not added up: a worse one takes over, and its credit with
// it); the attacks each made, the defenses each put up and the attacks each
// took with nothing but the SD, by the degree each attack came to.

export type DegreeShare = { degree: Degree; count: number; percent: number }
export type Tally = { total: number; shares: DegreeShare[] }
// `damage` is what reached the character, its degree and the defense met
// counted (combat.tex "Evade": "On a graze, the attack has 50% damage");
// `pastArmor` what of it went past the armor it was measured against.
export type Figures = { damage: number; pastArmor: number; IL: number; bleed: number }
export type DamageLine = Figures & { id: string; name: string }
export type FightReportRow = {
  id: string
  name: string
  party: string
  dealt: Figures & { wounds: number; kills: number }
  taken: Figures & { other: number }
  dealtTo: DamageLine[]
  takenFrom: DamageLine[]
  attacks: Tally
  attacksUnanswered: Tally
  defenses: Tally
  takenUndefended: Tally
}

// Whose bleed it is when nobody in the fight put it on.
const EARLIER = ''
const EARLIER_NAME = 'from before the fight'

type Hits = Map<string, Figures>

type Ledger = {
  hits: Map<string, Hits>
  wounds: Map<string, number>
  kills: Map<string, number>
  rise: Map<string, number>
  bleedLevel: Map<string, number>
  bleedBy: Map<string, string>
  attacks: Map<string, Degree[]>
  unanswered: Map<string, Degree[]>
  defenses: Map<string, Degree[]>
  undefended: Map<string, Degree[]>
}

export function getFightReport(state: SceneState): FightReportRow[] {
  const ledger: Ledger = { hits: new Map(), wounds: new Map(), kills: new Map(), rise: new Map(), bleedLevel: new Map(), bleedBy: new Map(), attacks: new Map(), unanswered: new Map(), defenses: new Map(), undefended: new Map() }
  const landed = getLanded(state)
  const editsAt = (i: number) => state.edits.filter((e) => e.landed === i || (i === landed.length && e.landed > i))
  for (let i = 0; i <= landed.length; i++) {
    for (const edit of editsAt(i)) readEdit(ledger, edit)
    if (i < landed.length) readAction(state, ledger, landed[i])
  }
  return Object.keys(state.names).map((id) => getRow(state, ledger, id))
}

// The report as lines, for the journal.
export function getFightReportLines(state: SceneState): string[] {
  const figures = (f: Figures) => `damage ${f.damage}, past armor ${f.pastArmor}, IL ${f.IL}, bled IL ${f.bleed}`
  const tally = (label: string, t: Tally) => (t.total === 0 ? [] : [`  ${label}: ${t.total} (${t.shares.map((s) => `${s.degree} ${s.count}, ${s.percent}%`).join('; ')})`])
  return getFightReport(state).flatMap((r) => [
    `${r.name}${r.party ? ` (${r.party})` : ''}`,
    `  dealt: ${figures(r.dealt)}, wounds ${r.dealt.wounds}, kills ${r.dealt.kills}`,
    ...r.dealtTo.map((l) => `    to ${l.name}: ${figures(l)}`),
    `  taken: ${figures(r.taken)}${r.taken.other > 0 ? `, IL otherwise ${r.taken.other}` : ''}`,
    ...r.takenFrom.map((l) => `    from ${l.name}: ${figures(l)}`),
    ...tally('attacks', r.attacks),
    ...tally('attacks met by the SD', r.attacksUnanswered),
    ...tally('defenses', r.defenses),
    ...tally('attacks taken without a defense', r.takenUndefended),
  ])
}

function push<T>(map: Map<string, T[]>, id: string, value: T): void {
  map.set(id, [...(map.get(id) ?? []), value])
}

function add(map: Map<string, number>, id: string, n: number): void {
  if (n !== 0) map.set(id, (map.get(id) ?? 0) + n)
}

const NONE: Figures = { damage: 0, pastArmor: 0, IL: 0, bleed: 0 }
const FIGURES = Object.keys(NONE) as (keyof Figures)[]

function hit(ledger: Ledger, from: string, to: string, part: Partial<Figures>): void {
  const byTarget = ledger.hits.get(from) ?? new Map<string, Figures>()
  const was = byTarget.get(to) ?? NONE
  byTarget.set(to, Object.fromEntries(FIGURES.map((k) => [k, was[k] + (part[k] ?? 0)])) as Figures)
  ledger.hits.set(from, byTarget)
}

// What one group of changes, to one character in one step, did to their IL
// and their bleed. `direct` is the IL the step's own results put on them;
// `bledOut` the IL the step owes to bleeding whatever else it did; `raiser`
// whom a worse bleed is credited to.
function readChanges(ledger: Ledger, id: string, changes: Change[], direct: number, bledOut: ((rise: number, STA: number, level: number) => number), raiser: string | null): void {
  const values = (what: string) => changes.filter((c): c is Extract<Change, { kind: 'value' }> => c.kind === 'value' && c.what === what)
  const rise = values('injury level').reduce((n, c) => n + Math.max(0, c.to - c.from), 0)
  const STA = values('STA').reduce((n, c) => n + Math.max(0, c.from - c.to), 0)
  const bleeds = values('bleed')
  const level = ledger.bleedLevel.get(id) ?? bleeds[0]?.from ?? 0
  add(ledger.rise, id, rise)
  const bled = Math.min(Math.max(0, rise - direct), bledOut(rise, STA, level))
  if (bled > 0) hit(ledger, ledger.bleedBy.get(id) ?? EARLIER, id, { bleed: bled })
  for (const c of bleeds) {
    if (c.to === 0) ledger.bleedBy.delete(id)
    else if (c.to > c.from && raiser !== null) ledger.bleedBy.set(id, raiser)
    ledger.bleedLevel.set(id, c.to)
  }
}

// combat.tex "Bleed": "For every STA spent ... +1 to their IL per bleed
// intensity".
const bySTA = (_rise: number, STA: number, level: number) => STA * level

function byCharacter(changes: Change[]): Map<string, Change[]> {
  const out = new Map<string, Change[]>()
  for (const c of changes) if (c.kind !== 'move') push(out, c.id, c)
  return out
}

function readEdit(ledger: Ledger, edit: EditEntry): void {
  // combat.tex "Bleed": the bleed at the turn of a round, and the IL the
  // test made as the fight ends takes for the bleed left
  const bleeding = edit.cause === ROUND_START_CAUSES.bleed || edit.cause.startsWith(TEND_AFTER_FIGHT_CAUSE)
  const environment = edit.cause === ROUND_START_CAUSES.environment
  for (const [id, changes] of byCharacter(edit.changes)) {
    readChanges(ledger, id, changes, 0, bleeding ? (rise) => rise : environment ? () => 0 : bySTA, null)
  }
}

function readAction(state: SceneState, ledger: Ledger, action: Action): void {
  const resolve = action.changes.filter((c) => c.phase === 'resolve')
  const before = action.changes.filter((c) => c.phase !== 'resolve')
  for (const [id, changes] of byCharacter(before)) readChanges(ledger, id, changes, 0, bySTA, null)
  const directOn = new Map<string, number>()
  for (const r of action.results) {
    if (r.outcome.stopped) continue
    add(directOn, r.targetId, r.outcome.IL)
    hit(ledger, action.actorId, r.targetId, { damage: r.outcome.damage, pastArmor: Math.max(0, r.outcome.damage - r.outcome.armor), IL: r.outcome.IL })
    if (r.outcome.wound) add(ledger.wounds, action.actorId, 1)
    if (r.outcome.dead) add(ledger.kills, action.actorId, 1)
  }
  for (const [id, changes] of byCharacter(resolve)) {
    readChanges(ledger, id, changes, directOn.get(id) ?? 0, bySTA, action.results.some((r) => r.targetId === id && r.outcome.bleed > 0) ? action.actorId : null)
  }
  readAttack(state, ledger, action)
}

function readAttack(state: SceneState, ledger: Ledger, action: Action): void {
  if (!isAttackAction(action) || action.targetId === null || action.roll === null || isVoided(state, action)) return
  const degree = action.roll.degree
  push(ledger.attacks, action.actorId, degree)
  const defense = action.defendedBy ? getAction(state, action.defendedBy) : null
  if (defense) push(ledger.defenses, defense.actorId, degree)
  else {
    push(ledger.unanswered, action.actorId, degree)
    push(ledger.undefended, action.targetId, degree)
  }
}

function getTally(degrees: Degree[]): Tally {
  const total = degrees.length
  return { total, shares: DEGREES.map((degree) => {
    const count = degrees.filter((d) => d === degree).length
    return { degree, count, percent: total === 0 ? 0 : Math.round((count / total) * 100) }
  }) }
}

function getRow(state: SceneState, ledger: Ledger, id: string): FightReportRow {
  const name = (who: string) => (who === EARLIER ? EARLIER_NAME : getFightName(state, who))
  const line = (who: string, h: Figures): DamageLine => ({ id: who, name: name(who), ...h })
  const some = (h: Figures) => FIGURES.some((k) => h[k] > 0)
  const dealtTo = [...(ledger.hits.get(id) ?? new Map())].filter(([, h]) => some(h)).map(([to, h]) => line(to, h))
  const takenFrom = [...ledger.hits].flatMap(([from, byTarget]) => { const h = byTarget.get(id); return h && some(h) ? [line(from, h)] : [] })
  const sum = (lines: DamageLine[]): Figures => Object.fromEntries(FIGURES.map((k) => [k, lines.reduce((n, l) => n + l[k], 0)])) as Figures
  const taken = sum(takenFrom)
  const partyId = state.partyOf[id]
  return {
    id,
    name: name(id),
    party: partyId ? state.parties[partyId]?.name ?? '' : '',
    dealt: { ...sum(dealtTo), wounds: ledger.wounds.get(id) ?? 0, kills: ledger.kills.get(id) ?? 0 },
    taken: { ...taken, other: Math.max(0, (ledger.rise.get(id) ?? 0) - taken.IL - taken.bleed) },
    dealtTo,
    takenFrom,
    attacks: getTally(ledger.attacks.get(id) ?? []),
    attacksUnanswered: getTally(ledger.unanswered.get(id) ?? []),
    defenses: getTally(ledger.defenses.get(id) ?? []),
    takenUndefended: getTally(ledger.undefended.get(id) ?? []),
  }
}
