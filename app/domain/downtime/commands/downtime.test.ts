import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from '../../factories'
import { getCatalogItem } from '../../item/rules/items'
import { addItemToContainer, putOnFromCatalog, receive } from '../../item/commands'
import { CampaignStateSchema } from '../../campaign/types'
import { passETs } from '../../campaign/commands/clock'
import { DowntimeStateSchema, type Downtime, type TrainingTarget } from '../types'
import { chooseTraining, decideTraining } from './plans'
import { passDays } from './downtime'
import { getAffordableDays, getDowntimeBar } from '../rules/downtime'

const strike: TrainingTarget = { kind: 'trainable', key: 'strike' }

function withPurse(coppers: number): Downtime {
  const dressed = addItemToContainer('Backpack', 'medium', getCatalogItem('Coin Pouch')!)(
    putOnFromCatalog(getCatalogItem('Backpack')!)(putOnFromCatalog(getCatalogItem('Belt')!)(makeCampaignCharacter({ name: 'A' }))),
  )
  return { campaign: CampaignStateSchema.parse({ characters: { a: receive(coppers)(dressed) }, partyOf: { a: 'p' }, parties: { p: { clock: 0, active: true, sequence: 'downtime' } } }), downtime: DowntimeStateSchema.parse({}) }
}

const trained = (t: Downtime) => t.campaign.characters.a.trainables.strike
const dice = () => 5

// A training with a trainer the table has accepted, of one XP (10 days).
const training = (t: Downtime): Downtime => decideTraining('a', 'accepted')(chooseTraining('a', strike, true)(t))

// The table's ruling: a block resolves as a whole once its days are over, and
// time spent elsewhere in between cancels it.
describe('downtime blocks', () => {
  it('gives nothing until its last day, and resolves on it', () => {
    const start = training(withPurse(10000))
    const partway = passDays(9, dice)(start)
    expect(trained(partway)).toEqual(trained(start))
    const done = passDays(1, dice)(partway)
    expect(trained(done)).not.toEqual(trained(start))
  })

  it('is lost when time passes elsewhere while it is under way', () => {
    const start = training(withPurse(10000))
    const partway = passDays(5, dice)(start)
    const elsewhere = { ...partway, campaign: passETs(1, ['p'])(partway.campaign) }
    const after = passDays(5, dice)(elsewhere)
    expect(trained(after)).toEqual(trained(start))
    expect(after.downtime.plans.a.block).toBeNull()
  })
})

// The table's ruling: the days pass only with a plan the purse pays for, and
// the plan says how long that is.
describe('affordability', () => {
  it('passes exactly the spans the plan is shown to pay for', () => {
    const t = training(withPurse(150))
    for (let span = 1; span <= 30; span++) {
      const affordable = getAffordableDays(t, 'a', span) >= span
      expect(getDowntimeBar(t, span) === null, `span ${span}`).toBe(affordable)
      expect(passDays(span, dice)(t) !== t, `span ${span}`).toBe(affordable)
    }
  })
})
