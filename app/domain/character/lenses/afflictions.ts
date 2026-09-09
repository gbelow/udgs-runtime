import { AfflictionKey, CampaignCharacter, Character, Skills } from '../../types'
import { AFFLICTIONS, AfflictionDef, SkillPenaltyTable } from '../../tables'
import { isCampaignCharacter } from '../../utils'
import { getBurdenLevel, getBurdenPenalty } from '../../item/lenses/containers'

// The full affliction set: what the GM toggled by hand, plus everything the
// character's own state forces on them. survival.tex states each resource's
// effects as exclusive bands, so a resource contributes exactly one rung of its
// ladder and `worstOfEachGroup` keeps a hand-set rung from stacking on top.
export function getAfflictions(character: Character): AfflictionKey[] {
  if (!isCampaignCharacter(character)) return []

  // Stored afflictions come through a permissive ingest (`z.array(z.any())`),
  // so a character saved before a rename can still carry a retired key.
  const afflictions = new Set<AfflictionKey>(
    character.afflictions.filter((key): key is AfflictionKey => key in AFFLICTIONS)
  )
  const rss = character.resources

  // survival.tex "Hunger": = 30 malnourished, 15-29 weakened.
  if (rss.hunger >= 30) afflictions.add('malnourished')
  else if (rss.hunger >= 15) afflictions.add('weakened')

  // survival.tex "Thirst": 12-14 unconscious + dehydrated, 8-11 dehydrated,
  // 4-7 thirsty. (15 = dead, which is not an affliction.)
  if (rss.thirst >= 12) {
    afflictions.add('dehydrated')
    afflictions.add('unconscious')
  } else if (rss.thirst >= 8) afflictions.add('dehydrated')
  else if (rss.thirst >= 4) afflictions.add('thirsty')

  // survival.tex "Rest, Exhaustion and Healing": > 11 confused, 8-11 exhausted,
  // 4-7 tired.
  if (rss.exhaustion > 11) afflictions.add('confused')
  else if (rss.exhaustion >= 8) afflictions.add('exhausted')
  else if (rss.exhaustion >= 4) afflictions.add('tired')

  // gear.tex "Containers and burden": an "over" burden also makes the character lame.
  if (getBurdenLevel(getBurdenPenalty(character)) === 'over') afflictions.add('lame')

  return worstOfEachGroup([...afflictions])
}

// Within a severity ladder only the worst rung applies — a malnourished
// character is at -2 Health, not at weakened's -1 plus malnourished's -2.
function worstOfEachGroup(keys: AfflictionKey[]): AfflictionKey[] {
  const worst = new Map<string, AfflictionKey>()
  for (const key of keys) {
    const { group, rank = 0 } = AFFLICTIONS[key]
    if (!group) continue
    const held = worst.get(group)
    if (held === undefined || rank > (AFFLICTIONS[held].rank ?? 0)) worst.set(group, key)
  }
  const survivors = new Set(worst.values())
  return keys.filter((key) => !AFFLICTIONS[key].group || survivors.has(key))
}

// combat.tex "Afflictions": a penalty names a category (sensory / mental /
// health) and applies to every skill in it. The injury penalty is deliberately
// absent — the rulebook puts it on STR/AGI/STA, so it reaches skills through
// the characteristic getters instead of through this table.
export function getAfflictionPenalty(character: Character, skill: keyof Skills): number {
  if (!isCampaignCharacter(character)) return 0

  let totalPenalty = 0
  for (const afflictionName of getAfflictions(character)) {
    const afflictionDef = AFFLICTIONS[afflictionName]
    for (const [category, affectedSkills] of Object.entries(SkillPenaltyTable)) {
      if (affectedSkills.includes(skill)) {
        totalPenalty += getPenaltyForCategory(afflictionDef, category as keyof typeof SkillPenaltyTable)
      }
    }
  }

  return totalPenalty
}

function getPenaltyForCategory(
  affliction: AfflictionDef,
  category: keyof typeof SkillPenaltyTable
): number {
  switch (category) {
    case 'sensory':
      return affliction.sensory ?? 0
    case 'mental':
      return affliction.mental ?? 0
    case 'health':
      return affliction.health ?? 0
    default:
      return 0
  }
}

// combat.tex "Injury level (IL)": "-1 as injury penalty for every multiple of
// 10".
export function getInjuryPenalty(c: Character): number {
  if (!isCampaignCharacter(c) || !c.injuries) return 0
  return Math.floor(c.injuries.injuryLevel / getIT(c))
}

// The 10 is flat — the rulebook gives nothing that moves it. The per-character
// `injuries.injuryThreshold` field and the health-affliction reduction below are
// staged out rather than deleted, in case the threshold becomes variable again.
export function getIT(_c: CampaignCharacter){
  // const afflictions = getAfflictions(c)
  // const pen = afflictions.filter(el => el === 'malnourished' || el === 'weakened' || el === 'thirsty' || el === 'dehydrated').length + (afflictions.includes('sick') ? 2 : 0)
  // return Math.max(1, c.injuries.injuryThreshold)
  return 10
}

// combat.tex "Afflictions": mental penalties hit "all spellcasting". Reads the
// derived set, so exhaustion and intoxication reach spells the same way a
// hand-set affliction does.
export function getMentalAfflictionPenalty(c: Character): number {
  return getAfflictions(c).reduce((total: number, key) => total + (AFFLICTIONS[key].mental ?? 0), 0)
}
