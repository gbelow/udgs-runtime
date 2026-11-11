import { describe, it, expect } from 'vitest'
import { SceneStateSchema, type SceneState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema, type CampaignCharacter } from '../../types'
import { grantAbility } from '../../character/commands/abilities'
import { holdItem } from '../../item/commands/hands'
import { getCatalogItem } from '../../item/rules/items'
import { SPELLS } from '../../spells'
import { getSpellOptions } from '../rules/cast'
import { getKnowledgeShortfallDL } from '../../character/rules/spells'

const book = getCatalogItem("Animancer's Grimoire")!
const spellKey = book.grimoire[0] as keyof typeof SPELLS

function caster(abilities: Parameters<typeof grantAbility>[0][], held = true): CampaignCharacter {
  const c = abilities.reduce<CampaignCharacter>((acc, key) => grantAbility(key)(acc), makeCampaignCharacter({ name: 'a' }))
  return { ...(held ? holdItem(ItemSchema.parse(book))(c) : c), id: 'a', resources: { ...c.resources, AP: 12, STA: 12 } }
}

const inFight = (c: CampaignCharacter): SceneState => ({ ...SceneStateSchema.parse({ round: 2 }), characters: { [c.id]: c }, partyOf: { [c.id]: 'x' } })
const offered = (c: CampaignCharacter) => getSpellOptions(inFight(c), c).find((o) => o.key === spellKey)

// spells.tex "Wizard": "Wizards can attempt to interact with anything that has
// magical properties, without prior learning [...] For every knowledge point
// missing compared to the object's requirement, increase difficulty by 5."
describe('a grimoire in a wizard’s hands', () => {
  it('offers the spells it holds, harder for the knowledge missing', () => {
    const wizard = caster(['magic-theory'])
    const option = offered(wizard)
    expect(option?.grimoire).toBe(book.name)
    expect(option?.DL).toBe((SPELLS[spellKey].DL ?? 0) + getKnowledgeShortfallDL(wizard, spellKey))
  })

  it('offers nothing to one who is no wizard, nor from a grimoire not in the hands', () => {
    expect(offered(caster([]))).toBeUndefined()
    expect(offered(caster(['magic-theory'], false))).toBeUndefined()
  })
})
