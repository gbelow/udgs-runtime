import { Character, Skills } from '../../types'

export const skill = (c: Character, key: keyof Skills) => c.trainables[key as keyof Skills] ?? 0

