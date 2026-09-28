import { Character, Movement, MovementKind } from "../../types";
import { getAGI } from "./characteristics";
import { getBuffBonus } from "./effects";

// The stored value from character.movement plus whatever abilities add to it.
export function getRaw (c: Character, key: keyof Character["movement"]) {
  return c.movement[key] + getBuffBonus(c, `movement:${key}`);
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
// combat.tex "jumping": "If performed during a run, increase the base
// calculation of the horizontal distance of a long jump to match that of
// running."
export function getRunningJumpMovement(c: Character) {
  return 3 + getRaw(c, "jump");
}
// combat.tex "Movement Costs and Speeds": "Stand up & 5 -AGI/5 AP", AGI
// with the injury penalty on it (combat.tex "Afflictions": "It affects all
// other usages of attributes").
export function getStandMovement(c: Character) {
  return 5 - Math.floor(getAGI(c) / 5) + getRaw(c, "stand");
}

export const movementGetters: Record<keyof Movement, (c: Character) => number> = {
  basic: getBasicMovement,
  careful: getCarefulMovement,
  crawl: getCrawlMovement,
  run: getRunMovement,
  jump: getJumpMovement,
  swim: getSwimMovement,
  "fast swim": getFastSwimMovement,
  stand: getStandMovement,
};

// combat.tex "Movement Costs and Speeds": metres per block of the kind.
export function getMovementSpeed(c: Character, kind: MovementKind): number {
  return movementGetters[kind](c);
}
