import { Character, CharacterUpdater, Skills } from '../types'

export function resetSkill(  
  skill: keyof Skills
): CharacterUpdater {
  return (character: Character) => ({ ...character, skills: {...character.skills, [skill]: 0} })
}

export function resetAllSkills(  
  skill: keyof Skills
): CharacterUpdater {
  return (character: Character) => {
    const skills = {...character.skills}
    for(skill in skills){
      skills[skill] = 0
    }
    return { ...character, skills  }
  }
}

