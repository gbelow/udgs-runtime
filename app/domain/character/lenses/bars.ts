import type { CampaignCharacter, Third } from '../../types'
import { ROUND_AP } from '../../tables'
import { getSTA } from '../rules/characteristics'
import { getBaseInjuryCapacity, getDeathIL, getInjuryCapacity } from '../rules/afflictions'
import { MOST_TENS, SHOWN_IL_STEP, thirdOf } from './face'

// What the character has left to spend, as a bar shaded by the third a face
// would show of it.
export type SpendBar = { fill: number, third: Third, label: string }
// How hurt they are, as a bar that fills up to the collapse no ability has
// raised and then starts again up to death, shaded by the ten a face shows
// (`level`, as a gauge's), with the character's own collapse marked on the lap
// it falls in and the frame lit once they have collapsed.
export type HurtBar = { fill: number, level: number, collapse: number | null, collapsed: boolean }
export type ResourceBars = { AP: SpendBar, STA: SpendBar, IL: HurtBar }

// What a face shows of a resource, and so what anyone is shown of it: its
// level, which picks its shade (lowest first), and how much of its gauge is
// filled, in percent. AP and STA show the third left, a third of the gauge
// for each; IL its tens up to the collapse, a fifth for each, its level the
// ten reached (the first for none, drawn empty). `label` says it in words.
export type Gauge = { level: number, fill: number, label: string }
export type Gauges = { AP: Gauge, STA: Gauge, IL: Gauge }

const percent = (value: number, most: number): number => (most <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((100 * value) / most))))

const tensOf = (c: CampaignCharacter): number => Math.min(MOST_TENS, Math.floor(c.injuries.injuryLevel / SHOWN_IL_STEP))
const hurtLevel = (tens: number): number => Math.max(0, tens - 1)

const THIRD_LABELS = ['low', 'middling', 'high'] as const
const thirdLabel = (t: Third): string => THIRD_LABELS[t] + ' (a third)'

function spend(value: number, most: number): SpendBar {
  const third = thirdOf(value, most)
  return { fill: percent(value, most), third, label: thirdLabel(third) }
}

// Where `value` falls on the lap from `from` to `to`, or null off it.
function onLap(value: number, from: number, to: number): number | null {
  return value >= from && value <= to ? percent(value - from, to - from) : null
}

function hurt(c: CampaignCharacter): HurtBar {
  const IL = c.injuries.injuryLevel
  const lap = getBaseInjuryCapacity(c)
  const death = getDeathIL(c)
  const capacity = getInjuryCapacity(c)
  const second = IL >= lap
  return {
    fill: second ? percent(IL - lap, death - lap) : percent(IL, lap),
    level: hurtLevel(tensOf(c)),
    collapse: second ? (capacity > lap ? onLap(capacity, lap, death) : null) : (capacity < lap ? onLap(capacity, 0, lap) : null),
    collapsed: IL >= capacity,
  }
}

const bars = new WeakMap<CampaignCharacter, ResourceBars>()

// The same bars for the same sheet, so a selector gating on them re-renders
// only when the sheet changes.
export function getResourceBars(c: CampaignCharacter): ResourceBars {
  let view = bars.get(c)
  if (!view) {
    view = {
      AP: spend(c.resources.AP, ROUND_AP),
      STA: spend(c.resources.STA, getSTA(c)),
      IL: hurt(c),
    }
    bars.set(c, view)
  }
  return view
}

const third = (t: Third): Gauge => ({ level: t, fill: percent(t + 1, 3), label: thirdLabel(t) })

const gauges = new WeakMap<CampaignCharacter, Gauges>()

// A face carries its thirds already (`getPublicFace`, `shown`) and its injury
// level by the ten; a sheet the viewer plays is read the same way. The same
// gauges for the same sheet.
export function getGauges(c: CampaignCharacter): Gauges {
  let view = gauges.get(c)
  if (!view) {
    const tens = tensOf(c)
    view = {
      AP: third(c.shown?.AP ?? thirdOf(c.resources.AP, ROUND_AP)),
      STA: third(c.shown?.STA ?? thirdOf(c.resources.STA, getSTA(c))),
      IL: { level: hurtLevel(tens), fill: percent(tens, MOST_TENS), label: tens === 0 ? 'injury level under 10' : `injury level ${tens * SHOWN_IL_STEP} or more` },
    }
    gauges.set(c, view)
  }
  return view
}
