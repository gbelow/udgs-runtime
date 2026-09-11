import { Character, Lens } from "../../types";
// combat.tex "Afflictions" excludes movement speeds from the injury penalty,
// so every speed below reads the unpenalized AGI base (gear burden still
// applies — gear.tex puts that penalty on the attribute itself).
import { getAGIBase } from "./characteristics";

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

// Returns just the stored value from character.movement if set, or default string/number
export function getRaw (c: Character, key: keyof Character["movement"]) {
  return c.movement[key];
};

export function getBasicMovement(c: Character) { 
  return getRaw(c, "basic");
}
export function getCarefulMovement(c: Character) {
  return getRaw(c, "careful");
}
export function getCrawlMovement(c: Character) {
  return getRaw(c, "crawl");
}
// combat.tex "Movement Costs and Speeds": Run and Jump are flat speeds; the
// stored term is a bonus on top of them.
export function getRunMovement(c: Character) {
  return 3 + getRaw(c, "run");
}
export function getSwimMovement(c: Character) {
  return getRaw(c, "swim");
}
export function getFastSwimMovement(c: Character) {
  return getRaw(c, "fast swim");
}
export function getJumpMovement(c: Character) {
  return 2 + getRaw(c, "jump");
}
export function getStandMovement(c: Character) {
  return 5 - Math.floor(getAGIBase(c)/ 5)+getRaw(c, "stand");
}
