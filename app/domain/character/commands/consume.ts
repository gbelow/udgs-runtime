import type { CampaignCharacter } from '../../types'
import { findCarriedItem } from '../../item/rules/containers'
import { getConsume, isLasting } from '../../item/rules/consumables'
import { getAppliedWith, getConsumeBar, getDoseCount } from '../../item/rules/doses'
import { spendDoses } from '../../item/commands/hands'
import { landed } from '../rules/production'
import { deliverAll } from './deliver'

// gear.tex "Potions and Medicine": a dose taken, as many as the taker's VM
// asks, and as many of what it is applied with. What it does lands at once;
// what lasts is kept by name for its ETs — "The effects of potions are not
// cumulative, but they can be refreshed by consuming another potion".
export function takeDose(itemId: string): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const item = findCarriedItem(c, itemId)?.item
    const consume = item ? getConsume(item) : null
    if (!item || !consume || getConsumeBar(c, item)) return c
    const doses = getDoseCount(c)
    const applied = getAppliedWith(c, item)
    const spent = spendDoses(itemId, doses)(applied ? spendDoses(applied.id, doses)(c) : c)
    const taken = deliverAll(consume.effects.filter((e) => !isLasting(e)).map(landed))(spent)
    if (consume.ETs <= 0 || !consume.effects.some(isLasting)) return taken
    const others = taken.active.filter((e) => !(e.kind === 'potion' && e.key === item.name))
    return { ...taken, active: [...others, { kind: 'potion', key: item.name, ETs: consume.ETs }] }
  }
}

// Time passing wears off what lasts so many ETs: each such entry has that
// many fewer left, and one with none is gone.
export function wearOff(ETs: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    if (ETs <= 0 || !c.active.some((e) => e.ETs !== undefined)) return c
    const active = c.active.flatMap((e) => {
      if (e.ETs === undefined) return [e]
      const left = (e.ETs ?? 0) - ETs
      return left > 0 ? [{ ...e, ETs: left }] : []
    })
    return { ...c, active }
  }
}
