import type { Character, Lens } from '../../types'

export function makeMovementLens<T extends Character>(
  moveName: keyof Character['movement'],
  getter: (c: T) => number,
  setter?: (c: T, value: number) => T
): Lens<T, number> {
  return {
    get: getter,
    set: setter ?? ((subject: T, value: number): T => {
      const calculated = getter(subject) - subject.movement[moveName]
      const updated = {...subject, movement: {...subject.movement, [moveName]: value - calculated}}
      return updated as T;
    })
  };
}
