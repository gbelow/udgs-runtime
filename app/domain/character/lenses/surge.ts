import { BUFF_TARGETS, type CampaignCharacter, type Skills, type SurgeKind } from '../../types'
import { SURGES, SURGE_ALLOWANCES, SURGE_USES, type Surge, type SurgeWindow } from '../../tables'
import { surgeKinds } from '../../lists'
import { canSurge, getSurged, knowsSurge } from '../rules/surge'
import { getAfflictions, getInjuryPenalty, isDead } from '../rules/afflictions'
import { getBuffBonus, getLearnedAbilities, getRollModes, getSuppressed, getSurgeAllows } from '../rules/effects'
import { characteristicLenses, movementLenses, skillLenses } from './index'

// View getter: which surge buttons are live, as a flat record of primitives the
// store selector can shallow-compare.
export function getSurgeAvailability(c: CampaignCharacter): Record<SurgeKind, boolean> {
  const availability = {} as Record<SurgeKind, boolean>
  for (const kind of surgeKinds) {
    availability[kind] = canSurge(kind)(c)
  }
  return availability
}

export type SurgeOption = { kind: SurgeKind; available: boolean; used: boolean }

// The surges the character may make, a surge only an ability gives among
// them once learned.
export function getSurgeOptions(c: CampaignCharacter, compelled: SurgeKind | null = null): SurgeOption[] {
  return surgeKinds.filter((kind) => knowsSurge(kind)(c)).map((kind) => ({
    kind,
    available: canSurge(kind, kind === compelled)(c),
    used: c.usedSurge === kind,
  }))
}

// What a surge gives whoever makes it, for a screen: the numbers it moves,
// what it allows and what it bars, and the abilities of theirs that speak of
// it. Nothing here is written down for a surge. The numbers are the character
// with the surge made against the same character without it, whatever brought
// the difference about, but for what the IL bled for its STA does, which is
// said as the IL, the injury penalty and what it leaves them; the sentences are the fields of `SURGES`, each of
// which has one (a field added does not compile until it does); and a change
// to the character that neither says is named as it is.
export type SurgeFacts = { gives: { label: string; value: number }[]; rules: string[]; abilities: string[] }

export function getSurgeFacts(c: CampaignCharacter, kind: SurgeKind): SurgeFacts {
  const known = facts.get(c) ?? new Map<SurgeKind, SurgeFacts>()
  facts.set(c, known)
  const kept = known.get(kind)
  if (kept) return kept
  const made = readFacts(c, kind)
  known.set(kind, made)
  return made
}

const facts = new WeakMap<CampaignCharacter, Map<SurgeKind, SurgeFacts>>()

function readFacts(c: CampaignCharacter, kind: SurgeKind): SurgeFacts {
  const before: CampaignCharacter = { ...c, usedSurge: null, runsFree: false, surgeFloor: null }
  const after = getSurged(kind)(before)
  return {
    gives: getGiven(before, after),
    rules: [...getFieldLines(after, kind), ...getModeLines(before, after), ...getSuppressionLines(before, after), ...getInjuryLines(before, after), ...getOtherLines(before, after)],
    abilities: [...new Set(getLearnedAbilities(c).filter((a) => a.description.toLowerCase().includes(`${kind} surge`)).map((a) => a.name))],
  }
}

type Given = SurgeFacts['gives']

const moved = (pairs: [label: string, before: number, after: number][]): Given =>
  pairs.flatMap(([label, before, after]) => (after === before ? [] : [{ label, value: after - before }]))

// The lenses the character is read through, by the family a buff names its
// target with.
const READ = { skill: skillLenses, characteristic: characteristicLenses, attribute: characteristicLenses, movement: movementLenses } as const

function getGiven(before: CampaignCharacter, after: CampaignCharacter): Given {
  const unbled: CampaignCharacter = { ...after, injuries: before.injuries }
  const resources = moved((Object.keys(after.resources) as (keyof CampaignCharacter['resources'])[]).map((k) => [k, before.resources[k], after.resources[k]]))
  const read = [skillLenses, characteristicLenses, movementLenses].flatMap((lenses) =>
    moved(Object.entries(lenses).map(([key, lens]) => [key, lens.get(before), lens.get(unbled)])))
  const other = BUFF_TARGETS.flatMap((target) => {
    const [family, key] = target.split(':')
    if (family in READ && key in READ[family as keyof typeof READ]) return []
    return moved([[`${key} ${family}`, getBuffBonus(before, target), getBuffBonus(unbled, target)]])
  })
  const injury = moved([
    ['IL (bleeding)', before.injuries.injuryLevel, after.injuries.injuryLevel],
    ['injury penalty', -getInjuryPenalty(before), -getInjuryPenalty(after)],
  ])
  return [...resources, ...read, ...other, ...injury]
}

const WINDOW_LINES: Record<SurgeWindow, string | null> = {
  any: null,
  turn: 'only in your own turn',
  turnOrAnswer: 'in your own turn or with a reaction',
  defense: 'made with a defense that repositions for an ally',
}

const listed = (names: readonly string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names.join(''))

// What each field of a surge is said as; null for one the numbers say, or that
// only tells whether the surge is offered at all.
const FIELD_LINES: { [F in keyof Required<Surge>]: (value: NonNullable<Surge[F]>, kind: SurgeKind, c: CampaignCharacter) => string | null } = {
  STA: () => null,
  AP: () => null,
  buffs: () => null,
  restsLess: () => null,
  learned: () => null,
  window: (window) => WINDOW_LINES[window],
  allows: (allows, kind, c) => `its AP only pay for ${listed([...allows.map((a) => SURGE_ALLOWANCES[a]), ...getSurgeAllows(c).filter((a) => a.surge === kind).map((a) => SURGE_ALLOWANCES[a.allows])].filter((x, i, all) => all.indexOf(x) === i))}`,
  earmarked: (earmarked) => (earmarked ? 'its AP left are lost when the turn or the reaction ends' : null),
  reactive: (reactive) => (reactive ? 'no turn can be started after it this round' : null),
  runsFree: () => 'running costs no STA until the turn or the reaction ends',
  readies: (uses) => `needed for ${listed(uses.map((u) => SURGE_USES[u]))}`,
  automatic: () => 'made by itself when the round ends with no surge made',
  forbiddenBy: (affliction) => `not while ${affliction}`,
}

function getFieldLines(after: CampaignCharacter, kind: SurgeKind): string[] {
  const surge: Surge = SURGES[kind]
  const line = <F extends keyof Surge>(field: F): string | null => {
    const value = surge[field]
    return value === undefined || value === null ? null : FIELD_LINES[field](value as NonNullable<Surge[F]>, kind, after)
  }
  return (Object.keys(FIELD_LINES) as (keyof Surge)[]).map(line).filter((l) => l !== null)
}

function getModeLines(before: CampaignCharacter, after: CampaignCharacter): string[] {
  return (Object.keys(skillLenses) as (keyof Skills)[]).flatMap((skill) => {
    const had = getRollModes(before, skill, true)
    return getRollModes(after, skill, true).filter((mode) => !had.includes(mode)).map((mode) => `${skill} may be thrown ${mode}`)
  })
}

function getSuppressionLines(before: CampaignCharacter, after: CampaignCharacter): string[] {
  const had = getSuppressed(before)
  return [...getSuppressed(after)].filter((target) => !had.has(target)).map((target) => `unaffected by ${target}`)
}

// What the IL bled for the surge's STA leaves the character.
function getInjuryLines(before: CampaignCharacter, after: CampaignCharacter): string[] {
  if (isDead(after) && !isDead(before)) return ['the bleeding kills them']
  const had = getAfflictions(before)
  return getAfflictions(after).filter((key) => !had.includes(key)).map((key) => `leaves them ${key}`)
}

// What of the character the surge is written in, and what of it the numbers
// and the fields have said.
const SAID: ReadonlySet<string> = new Set(['usedSurge', 'surgeFloor', 'runsFree', 'resources', 'injuries'])

function getOtherLines(before: CampaignCharacter, after: CampaignCharacter): string[] {
  return (Object.keys(after) as (keyof CampaignCharacter)[]).filter((key) => !SAID.has(key) && before[key] !== after[key]).map((key) => `changes ${key}`)
}

// The facts as a screen prints them: the numbers in a line, the rest a line each.
export function getGivesLine({ gives }: SurgeFacts): string {
  return gives.map(({ label, value }) => `${value < 0 ? '−' : '+'}${Math.abs(value)} ${label}`).join(' ')
}

export function getRuleLines({ rules, abilities }: SurgeFacts): string[] {
  return [...rules, ...(abilities.length > 0 ? [`see ${abilities.join(', ')}`] : [])]
}
