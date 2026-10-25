import type { GroundKey } from '../domain/scene/types'

export const GROUND: Record<GroundKey, { label: string, src: string }> = {
  meadow: { label: 'meadow', src: '/ground/meadow.svg' },
  earth: { label: 'earth', src: '/ground/earth.svg' },
  flagstone: { label: 'flagstone', src: '/ground/flagstone.svg' },
}
