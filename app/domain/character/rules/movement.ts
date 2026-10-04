import { Character, Movement, MovementKind } from "../../types";
import { MOVEMENT_BLOCKS, type MovementBlock } from "../../tables";
import { getAGI } from "./characteristics";
import { getBuffBonus } from "./effects";

// How far the stored block goes plus whatever abilities add to it.
function getDistance(c: Character, key: keyof Movement) {
  return c.movement[key].distance + getBuffBonus(c, `movement:${key}`);
}

export function getBasicMovement(c: Character) {
  return getDistance(c, "basic");
}
export function getCarefulMovement(c: Character) {
  return getDistance(c, "careful");
}
export function getCrawlMovement(c: Character) {
  return getDistance(c, "crawl");
}
export function getClimbMovement(c: Character) {
  return getDistance(c, "climb");
}
export function getRunMovement(c: Character) {
  return getDistance(c, "run");
}
export function getSwimMovement(c: Character) {
  return getDistance(c, "swim");
}
export function getFastSwimMovement(c: Character) {
  return getDistance(c, "fast swim");
}
export function getJumpMovement(c: Character) {
  return getDistance(c, "jump");
}
// combat.tex "jumping": "If performed during a run, increase the base
// calculation of the horizontal distance of a long jump to match that of
// running."
export function getRunningJumpMovement(c: Character) {
  return getJumpMovement(c) + MOVEMENT_BLOCKS.run.distance - MOVEMENT_BLOCKS.jump.distance;
}
// combat.tex "Movement Costs and Speeds": "Stand up & 5 -AGI/5 AP", AGI
// with the injury penalty on it (combat.tex "Afflictions": "It affects all
// other usages of attributes").
export function getStandMovement(c: Character) {
  return c.movement.stand.AP - Math.floor(getAGI(c) / 5) + getBuffBonus(c, "movement:stand");
}

export const movementGetters: Record<keyof Movement, (c: Character) => number> = {
  basic: getBasicMovement,
  careful: getCarefulMovement,
  crawl: getCrawlMovement,
  climb: getClimbMovement,
  run: getRunMovement,
  jump: getJumpMovement,
  swim: getSwimMovement,
  "fast swim": getFastSwimMovement,
  stand: getStandMovement,
};

// combat.tex "Movement Costs and Speeds": metres a block of the kind goes.
export function getMovementSpeed(c: Character, kind: MovementKind): number {
  return movementGetters[kind](c);
}

// What a block of the kind costs the character and how far it goes.
export function getMovementBlock(c: Character, kind: MovementKind): MovementBlock {
  const { AP, STA } = c.movement[kind];
  return { AP, STA, distance: getMovementSpeed(c, kind) };
}
