import { CampaignCharacter, Character } from '../types'
import { SkillPenaltyTable, AFFLICTIONS as afflictionDefinitions } from '../tables'
import { isCampaignCharacter } from '../utils'

export function getAfflictions(character: Character){
  if(!isCampaignCharacter(character)) return []
  const afflictions = new Set(character.afflictions)
  const rss = character.resources

  if(rss.hunger > 15) afflictions.add('weakened') 
  if(rss.hunger > 60) afflictions.add('malnourished')

  if(rss.thirst > 10) afflictions.add('thirsty') 
  if(rss.thirst > 15) afflictions.add('dehydrated')

  if(rss.exhaustion > character.resources.STA/2) afflictions.add('tired')
  if(rss.exhaustion > character.resources.STA) afflictions.add('exhausted')
  
  return [...afflictions]
}

export function getAfflictionPenalty(
  character: Character,
  skill: keyof Character['skills']
): number {
  if(!isCampaignCharacter(character)) return 0
  
  const injuryPenalty = getInjuryPenalty(character)

  const afflictions = getAfflictions(character)
  if (afflictions.length === 0) {
    return injuryPenalty
  }
  
  let totalPenalty = 0  
  
  for (const afflictionName of afflictions) {
    // Type guard: ensure afflictionName is a valid key
    if (!(afflictionName in afflictionDefinitions)) {
      // Skip invalid affliction names (defensive programming)
      continue
    }
    const afflictionDef = afflictionDefinitions[afflictionName]
    
    // Check each penalty category that affects this skill
    for (const [category, affectedSkills] of Object.entries(SkillPenaltyTable)) {
      if (affectedSkills.includes(skill)) {
        const penaltyValue = category != 'injury' ? getPenaltyForCategory(afflictionDef, category as keyof typeof SkillPenaltyTable) : injuryPenalty
        if (penaltyValue > 0) {
          totalPenalty += penaltyValue
        }
      }
    }
  }

  return totalPenalty
}

function getPenaltyForCategory(
  affliction: { mobility?: number; vision?: number; mental?: number; health?: number; [key: string]: unknown },
  category: keyof typeof SkillPenaltyTable
): number {
  switch (category) {
    case 'mobility':
      return affliction.mobility ?? 0
    case 'vision':
      return affliction.vision ?? 0
    case 'mental':
      return affliction.mental ?? 0
    case 'health':
      return affliction.health ?? 0
    default:
      return 0
  }
}

export function getInjuryPenalty(c : CampaignCharacter) : number {
  if(!c.injuries) return 0  
    const injPen = Math.floor(c.injuries.light.filter(el => el != 0).length/2) + 
    c.injuries.serious.filter(el => el != 0).length + 
    2*c.injuries.deadly.filter(el => el != 0).length
    return injPen
  
}
