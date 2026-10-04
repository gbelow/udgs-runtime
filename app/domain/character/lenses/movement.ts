import type { Character, Lens } from '../../types'

export function makeMovementLens<T extends Character>(
  moveName: keyof Character['movement'],
  getter: (c: T) => number,
  field: 'distance' | 'AP' = 'distance',
  setter?: (c: T, value: number) => T
): Lens<T, number> {
  return {
    get: getter,
    set: setter ?? ((subject: T, value: number): T => {
      const calculated = getter(subject) - subject.movement[moveName][field]
      const updated = {...subject, movement: {...subject.movement, [moveName]: {...subject.movement[moveName], [field]: value - calculated}}}
      return updated as T;
    })
  };
}
