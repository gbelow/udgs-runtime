import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from '../../factories'
import { getCatalogItem } from '../../item/rules/items'
import { addItemToContainer, putOnFromCatalog, receive } from '../../item/commands'
import { CampaignStateSchema } from '../../campaign/types'
import { passETs } from '../../campaign/commands/clock'
import { DowntimeStateSchema, type Downtime, type TrainingTarget } from '../types'
import { chooseActivity, chooseTraining, decideTraining, setBlock } from './plans'
import { answerDowntime, passDays } from './downtime'
import { getAffordableDays, getDowntimeBar } from '../rules/downtime'
import { grantAbility } from '../../character/commands/abilities'
import { ABILITIES } from '../../abilities'

const strike: TrainingTarget = { kind: 'trainable', key: 'strike' }

function withPurse(coppers: number): Downtime {
  const dressed = addItemToContainer('Backpack', 'medium', getCatalogItem('Coin Pouch')!)(
    putOnFromCatalog(getCatalogItem('Backpack')!)(putOnFromCatalog(getCatalogItem('Belt')!)(makeCampaignCharacter({ name: 'A' }))),
  )
  return { campaign: CampaignStateSchema.parse({ characters: { a: receive(coppers)(dressed) }, partyOf: { a: 'p' }, parties: { p: { clock: 0, active: true, sequence: 'downtime' } } }), downtime: DowntimeStateSchema.parse({}) }
}

const trained = (t: Downtime) => t.campaign.characters.a.trainables.strike

// A training with a trainer the table has accepted, of one XP (10 days).
const training = (t: Downtime): Downtime => decideTraining('a', 'accepted')(chooseTraining('a', strike, true)(t))

// The table's ruling: a block resolves as a whole once its days are over, and
// time spent elsewhere in between cancels it.
describe('downtime blocks', () => {
  it('gives nothing until its last day, and resolves on it', () => {
    const start = training(withPurse(10000))
    const partway = passDays(9)(start)
    expect(trained(partway)).toEqual(trained(start))
    const done = passDays(1)(partway)
    expect(trained(done)).not.toEqual(trained(start))
  })

  it('is lost when time passes elsewhere while it is under way', () => {
    const start = training(withPurse(10000))
    const partway = passDays(5)(start)
    const elsewhere = { ...partway, campaign: passETs(1, ['p'])(partway.campaign) }
    const after = passDays(5)(elsewhere)
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
      expect(passDays(span)(t) !== t, `span ${span}`).toBe(affordable)
    }
  })
})

// A die is rolled when the test calls for it: the days wait on it, and what was
// typed in is what the test was made with.
describe('days that call for a die', () => {
  it('pass only once the die is entered, with that die', () => {
    const start = chooseTraining('a', strike, false)(withPurse(10000))
    const called = passDays(10)(start)
    expect(called.campaign.parties.p.clock).toBe(0)
    const [call] = Object.values(called.downtime.calls)
    const passed = answerDowntime(call.id, 7, 'entered')(called)
    expect(passed.campaign.parties.p.clock).toBeGreaterThan(0)
    expect(passed.downtime.results.find((r) => r.roll)?.roll).toMatchObject({ die: 7, source: 'entered' })
  })
})

// abilities.tex "Excitement": "+1 Hedonism XP for every specific knowledge level gained".
describe('Excitement', () => {
  it('pays Hedonism XP for each level a learning test gains', () => {
    const start = withPurse(10000)
    const a = grantAbility('excitement')(start.campaign.characters.a)
    const hedonist = { ...a, trainables: { ...a.trainables, conviction1: { ...a.trainables.conviction1, name: 'Hedonism', value: 2, XP: 0 } } }
    const learning = setBlock('a', { knowledge: 'Haldor Town', DL: 0, gains: [3, 3, 3, 3], max: 3 })(chooseActivity('a', 'learning')({ ...start, campaign: { ...start.campaign, characters: { a: hedonist } } }))
    const called = passDays(30)(learning)
    const [call] = Object.values(called.downtime.calls)
    const done = call ? answerDowntime(call.id, 7, 'entered')(called) : called
    const gained = Object.values(done.campaign.characters.a.specificKnowledges).reduce((sum, level) => sum + level, 0)
    expect(gained).toBeGreaterThan(0)
    expect(done.campaign.characters.a.trainables.conviction1.XP).toBe(gained * ABILITIES.excitement.attitudes[0].XP)
  })
})
