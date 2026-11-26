import type { CampaignCharacter, Third } from '../../types'
import { ROUND_AP } from '../../tables'
import { getSTA } from '../rules/characteristics'
import { getBaseInjuryCapacity, getDeathIL, getInjuryCapacity } from '../rules/afflictions'
import { SHOWN_IL_STEP, thirdOf } from './face'

// What the character has left to spend, as a bar coloured by the third a face
// would show of it.
export type SpendBar = { fill: number, third: Third }
// How hurt they are, as a bar that fills up to the collapse no ability has
// raised and then starts again up to death, coloured by the tens a face shows,
// with the character's own collapse marked on the lap it falls in and the
// frame lit once they have collapsed.
export type HurtBar = { fill: number, tens: number, collapse: number | null, collapsed: boolean }
export type ResourceBars = { AP: SpendBar, STA: SpendBar, IL: HurtBar }

// the tens a face colours no further than: combat.tex "Injuries and Death" has them collapse at 50
const MOST_TENS = 5

const percent = (value: number, most: number): number => (most <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((100 * value) / most))))

function spend(value: number, most: number): SpendBar {
  return { fill: percent(value, most), third: thirdOf(value, most) }
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
    tens: Math.min(MOST_TENS, Math.floor(IL / SHOWN_IL_STEP)),
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
