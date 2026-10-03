import type { CampaignCharacter, Item } from '../../types'
import type { Change, CombatState } from '../types'
import { WOUNDS } from '../../tables'
import { getFightName } from './fighters'

// What a step changed in the fight: every number a character carries, every
// wound, affliction, part and surge they gained or lost, every item that went
// from one place to another, and every character who moved on the board —
// found by comparing the fight before and after, so nothing a command does to
// a character can go unsaid.

type Phase = Change['phase']

const COUNTERS: { what: string; read: (c: CampaignCharacter) => number }[] = [
  { what: 'AP', read: (c) => c.resources.AP },
  { what: 'surge AP', read: (c) => c.resources.surgeAP },
  { what: 'STA', read: (c) => c.resources.STA },
  { what: 'hunger', read: (c) => c.resources.hunger },
  { what: 'thirst', read: (c) => c.resources.thirst },
  { what: 'exhaustion', read: (c) => c.resources.exhaustion },
  { what: 'injury level', read: (c) => c.injuries.injuryLevel },
  { what: 'bleed', read: (c) => c.injuries.bleed },
  { what: 'burning', read: (c) => c.injuries.burning },
  { what: 'scorch', read: (c) => c.injuries.scorch },
  { what: 'potion', read: (c) => c.injuries.potion },
]

export function getChanges(before: CombatState, after: CombatState, phase: Phase): Change[] {
  const characters = Object.keys(after.characters).flatMap((id) => {
    const was = before.characters[id]
    return was ? getCharacterChanges(id, was, after.characters[id], phase) : []
  })
  return [...characters, ...getItemChanges(before, after, phase), ...getPlacementChanges(before, after, phase)]
}

function getCharacterChanges(id: string, was: CampaignCharacter, now: CampaignCharacter, phase: Phase): Change[] {
  const values = COUNTERS.flatMap(({ what, read }): Change[] => (read(was) === read(now) ? [] : [{ kind: 'value', phase, id, what, from: read(was), to: read(now) }]))
  const gain = (what: 'wound' | 'affliction' | 'part' | 'surge', names: { name: string; gained: boolean }[]): Change[] => names.map(({ name, gained }) => ({ kind: 'gain', phase, id, what, name, gained }))

  const woundName = (c: CampaignCharacter, w: { key: keyof typeof WOUNDS; part: string }) => `${WOUNDS[w.key].name} (${c.body.find((p) => p.id === w.part)?.name ?? w.part})`
  const hadWounds = new Set(was.injuries.wounds.map((w) => woundName(was, w)))
  const hasWounds = new Set(now.injuries.wounds.map((w) => woundName(now, w)))
  const hadAfflictions = new Set(was.afflictions)
  const hasAfflictions = new Set(now.afflictions)
  const lostBefore = new Set(was.body.filter((p) => p.lost).map((p) => p.name))
  const lostNow = new Set(now.body.filter((p) => p.lost).map((p) => p.name))

  return [
    ...values,
    ...gain('wound', [...diffSets(hadWounds, hasWounds)]),
    ...gain('affliction', [...diffSets(hadAfflictions, hasAfflictions)]),
    ...gain('part', [...diffSets(lostBefore, lostNow)]),
    ...(was.usedSurge === now.usedSurge ? [] : gain('surge', [{ name: (now.usedSurge ?? was.usedSurge) as string, gained: now.usedSurge !== null }])),
  ]
}

function diffSets(was: Set<string>, now: Set<string>): { name: string; gained: boolean }[] {
  return [
    ...[...now].filter((n) => !was.has(n)).map((name) => ({ name, gained: true })),
    ...[...was].filter((n) => !now.has(n)).map((name) => ({ name, gained: false })),
  ]
}

// Every item in the fight and where it is, by id.
function getPlaces(state: CombatState): Map<string, { name: string; place: string }> {
  const places = new Map<string, { name: string; place: string }>()
  const add = (item: Item, place: string) => {
    places.set(item.id, { name: item.name || item.refId, place })
    for (const contained of Object.values(item.container?.slots ?? {}).flatMap((slot) => slot.items)) add(contained, `inside ${item.name || item.refId}`)
  }
  for (const c of Object.values(state.characters)) {
    const owner = getFightName(state, c.id)
    for (const item of c.held) add(item, `${owner}'s hands`)
    if (c.onBack) add(c.onBack, `${owner}'s back`)
    if (c.worn) add(c.worn, `${owner}'s body`)
    for (const [key, container] of Object.entries(c.containers)) {
      for (const item of Object.values(container.slots).flatMap((slot) => slot.items)) add(item, `${owner}'s ${container.name || key}`)
    }
  }
  for (const { item, cell } of state.floor) add(item, cell ? `the floor at ${cellText(cell)}` : 'the floor')
  return places
}

function getItemChanges(before: CombatState, after: CombatState, phase: Phase): Change[] {
  const was = getPlaces(before)
  const now = getPlaces(after)
  const moved = [...now].flatMap(([id, { name, place }]): Change[] => {
    const from = was.get(id)?.place ?? 'nowhere'
    return from === place ? [] : [{ kind: 'move', phase, id: '', what: 'item', name, from, to: place }]
  })
  const gone = [...was].filter(([id]) => !now.has(id)).map(([, { name, place }]): Change => ({ kind: 'move', phase, id: '', what: 'item', name, from: place, to: 'gone' }))
  return [...moved, ...gone]
}

function getPlacementChanges(before: CombatState, after: CombatState, phase: Phase): Change[] {
  if (!after.board) return []
  return Object.entries(after.board.placements).flatMap(([id, placed]): Change[] => {
    const from = before.board?.placements[id]?.cell
    const to = placed.cell
    if (!from || (from.q === to.q && from.r === to.r)) return []
    return [{ kind: 'move', phase, id, what: 'character', name: getFightName(after, id), from: cellText(from), to: cellText(to) }]
  })
}

function cellText(cell: { q: number; r: number }): string {
  return `(${cell.q}, ${cell.r})`
}
