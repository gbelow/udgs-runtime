import type { CampaignCharacter, Third } from '../../types'
import { ROUND_AP } from '../../tables'
import { getSTA } from '../rules/characteristics'
import { getDeathIL, getInjuryCapacity } from '../rules/afflictions'
import { SHOWN_IL_STEP, thirdOf } from './face'

// What the character has left to spend, as a bar coloured by the third a face
// would show of it.
export type SpendBar = { fill: number, third: Third }
// How hurt they are, as a bar filling to death, coloured by the tens a face
// shows, with the collapse marked along it.
export type HurtBar = { fill: number, tens: number, collapse: number }
export type ResourceBars = { AP: SpendBar, STA: SpendBar, IL: HurtBar }

// the tens a face colours no further than: combat.tex "Injuries and Death" has them collapse at 50
const MOST_TENS = 5

const percent = (value: number, most: number): number => (most <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((100 * value) / most))))

function spend(value: number, most: number): SpendBar {
  return { fill: percent(value, most), third: thirdOf(value, most) }
}

const bars = new WeakMap<CampaignCharacter, ResourceBars>()

// The same bars for the same sheet, so a selector gating on them re-renders
// only when the sheet changes.
export function getResourceBars(c: CampaignCharacter): ResourceBars {
  let view = bars.get(c)
  if (!view) {
    const IL = c.injuries.injuryLevel
    const death = getDeathIL(c)
    view = {
      AP: spend(c.resources.AP, ROUND_AP),
      STA: spend(c.resources.STA, getSTA(c)),
      IL: { fill: percent(IL, death), tens: Math.min(MOST_TENS, Math.floor(IL / SHOWN_IL_STEP)), collapse: percent(getInjuryCapacity(c), death) },
    }
    bars.set(c, view)
  }
  return view
}
