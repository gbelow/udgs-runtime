import { Character, CharacterUpdater, Skills } from '../types'

export function resetSkill(  
  skill: keyof Skills
): CharacterUpdater {
  return (character: Character) => ({ ...character, skills: {...character.skills, [skill]: 0} })
}

export function resetAllSkills(  
): CharacterUpdater {
  return (character: Character) => {
    const skills = { ...character.skills } as Skills
    for (const key of Object.keys(skills) as Array<keyof Skills>) {
      skills[key] = 0
    }
    return { ...character, skills }
  }
}

