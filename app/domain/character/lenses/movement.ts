import type { Character, Lens } from '../../types'

// What a block of the movement costs in AP or STA: stored as typed, no
// modifier stands between the stored value and the cost.
export function makeMovementCostLens<T extends Character>(
  moveName: keyof Character['movement'],
  field: 'AP' | 'STA',
): Lens<T, number> {
  return {
    get: (c: T) => c.movement[moveName][field],
    set: (c: T, value: number): T => ({ ...c, movement: { ...c.movement, [moveName]: { ...c.movement[moveName], [field]: value } } }),
  }
}

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
