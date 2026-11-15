import type { SceneState } from '../../app/domain/scene/types'
import type { SceneCommand } from '../../app/domain/scene/commands/registry'
import { getOpenAction } from '../../app/domain/scene/rules/log'
import type { Entry, Run } from '../../app/domain/bot/seat'
import { openHarness } from '../../app/stores/boardHarness'
import { useCombatStore } from '../../app/stores/useCombatStore'
import { getRoundPhase } from '../../app/domain/scene/rules/roundChange'
import { distance } from '../../app/domain/scene/rules/board/geometry'
import { isDown } from '../../app/domain/bot/table'
import { formatTable } from './table'

// One fight told round by round, for reading what the bots did and why: the
// fight's own record played again a command at a time (so it is the fight as
// it was played), and at the start of each round where everyone stands and
// what they hold; then each decision with the box's reason, what each attack
// came to, the round's rest and morale tests, and who went down. Written as
// markdown whose tables line up in the file.

type Sides = { red: readonly string[]; blue: readonly string[] }

const sideOf = (sides: Sides, id: string) => (sides.red.includes(id) ? 'red' : sides.blue.includes(id) ? 'blue' : '-')

function standing(s: SceneState, sides: Sides): string {
  const ids = [...sides.red, ...sides.blue]
  const at = (id: string) => s.board?.placements[id]?.cell ?? null
  const rows = ids.map((id) => {
    const c = s.characters[id]
    const here = at(id)
    const foes = (sides.red.includes(id) ? sides.blue : sides.red).filter((f) => !isDown(s, f) && at(f))
    const near = here && foes.length ? Math.min(...foes.map((f) => distance(here, at(f)!))) : null
    return [
      c.name,
      sideOf(sides, id),
      c.resources.AP,
      c.resources.STA,
      c.injuries.injuryLevel,
      c.injuries.bleed,
      isDown(s, id) ? 'down' : c.afflictions.join(', ') || '-',
      here ? `${here.q}, ${here.r}` : '-',
      near ?? '-',
    ]
  })
  return formatTable(['character', 'side', 'AP', 'STA', 'IL', 'bleed', 'afflictions', 'cell', 'nearest foe'], rows, ['left', 'left', 'right', 'right', 'right', 'right', 'left', 'left', 'right'])
}

// A character's name with its side, since both sides may field the same sheets.
let sidesNow: Sides = { red: [], blue: [] }
const nameOf = (s: SceneState, id: string | null | undefined) => (id && s.characters[id] ? `${s.characters[id].name} (${sideOf(sidesNow, id)})` : id || '?')

// Whose decision a press was: the character it names first, the actor of the
// action open when it was pressed, or the one holding the turn.
function whoOf(s: SceneState, command: SceneCommand): string | null {
  const first = (command.args as readonly unknown[])[0]
  return typeof first === 'string' && s.characters[first] ? first : getOpenAction(s)?.actorId ?? (s.inTurnCharacter || null)
}

// The presses that move the table on and decide nothing, left out.
const ROUTINE = new Set(['pay', 'roll', 'resolve', 'lets it go'])

// What the actions that landed with a command came to: the degree, and for
// each target the IL and bleed it took.
function landedLines(before: SceneState, after: SceneState): string[] {
  const done = new Set(before.landed)
  return after.landed.filter((id) => !done.has(id)).flatMap((id) => {
    const a = after.actions[id]
    if (!a || (a.kind !== 'strike' && a.kind !== 'shoot')) return []
    const degree = a.roll?.degree ?? 'no roll'
    const hits = a.results.filter((r) => r.outcome.IL > 0 || r.outcome.bleed > 0).map((r) => `${nameOf(after, r.targetId)} takes ${r.outcome.IL} IL${r.outcome.bleed ? `, bleed ${r.outcome.bleed}` : ''}`)
    const answer = Object.values(after.actions).find((r) => r.reactionTo === a.id && r.actorId === a.targetId)
    return [`  - ${nameOf(after, a.actorId)}'s ${a.kind} on ${nameOf(after, a.targetId)}: **${degree}**${answer ? ` against ${answer.kind}` : ''}${hits.length ? `; ${hits.join('; ')}` : '; no harm'}`]
  })
}

// What the morale tests thrown with a command came to.
function moraleLines(before: SceneState, after: SceneState): string[] {
  return after.morale.flatMap((m) => {
    const was = before.morale.find((x) => x.id === m.id)
    if (!m.roll || (was?.roll && was.roll.score === m.roll.score && was.roll.degree === m.roll.degree)) return []
    return [`  - ${nameOf(after, m.id)}'s morale test: ${m.roll.score} against DL ${m.roll.DL}, **${m.roll.degree}**${m.roll.limitStress ? ', limit stress action' : ''}`]
  })
}

function downLines(before: SceneState, after: SceneState, sides: Sides): string[] {
  return [...sides.red, ...sides.blue].filter((id) => !isDown(before, id) && isDown(after, id)).map((id) => `  - **${nameOf(after, id)} goes down** (IL ${after.characters[id].injuries.injuryLevel})`)
}

export function writeTrace(title: string, played: Run, sides: Sides): string {
  let queue: number[] = []
  const h = openHarness(() => queue.shift() ?? 0, { table: played.record.table })
  useCombatStore.setState({ ...played.record.start, activeCharacterId: null })
  sidesNow = sides
  const out: string[] = [`# ${title}`, '', `Ended: ${played.end}, in round ${played.rounds}. Each decision names the character, its side and the box's reason; the lines under it are what came of it. The table's own presses (pay, roll, land) are left out.`, '']
  let shownRound = -1
  let changing = false
  const flushRound = () => {
    const s = h.state()
    if (s.round !== shownRound && getRoundPhase(s) === null && s.round > 0) {
      shownRound = s.round
      out.push('', `## Round ${s.round}`, '', standing(s, sides), '')
    }
  }
  for (const entry of played.log as Entry[]) {
    for (const { command, dice } of entry.sent) {
      const before = h.state()
      queue = [...dice]
      h.send(command)
      const after = h.state()
      const phase = getRoundPhase(after)
      if (phase && !changing && before.round > 0) out.push('', `### Round change after round ${before.round}`, '')
      changing = phase !== null
      if (command === entry.sent[0].command && entry.by !== 'table' && !ROUTINE.has(entry.why)) out.push(`- **${nameOf(after, whoOf(before, command))}**: ${entry.why}${entry.refused ? `; refused: ${entry.refused}` : ''}`)
      out.push(...landedLines(before, after), ...moraleLines(before, after), ...downLines(before, after, sides))
      flushRound()
    }
    if (entry.sent.length === 0 && entry.refused) out.push(`- (${entry.by}): ${entry.why}; refused: ${entry.refused}`)
  }
  out.push('', '## At the end', '', standing(h.state(), sides), '')
  return out.join('\n')
}
