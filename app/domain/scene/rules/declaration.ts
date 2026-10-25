import { AttackAim, AttackMade, ShotDeclaration, StrikeDeclaration, StrikeModifiersSchema, type ShootAction, type StrikeAction } from '../types'

// An attack is declared the same way whatever declares it (types.ts
// `StrikeDeclaration`, `ShotDeclaration`): what declares it holds the
// declaration, and the attack it opens is made with it whole. The fields are
// read off the schema, so one added to the declaration is carried with it.
// What declares a strike may be declared as more than the strike can (an
// opportunity attack's maneuver, made gently): only the strike's own
// modifiers go with it.

export type StrikeDeclared = Pick<StrikeAction, keyof typeof StrikeDeclaration>
export type ShotDeclared = Pick<ShootAction, keyof typeof ShotDeclaration>
export type Aimed = Pick<StrikeAction, keyof typeof AttackAim>
export type Made = Pick<StrikeAction, keyof typeof AttackMade>

const STRIKE_KEYS = Object.keys(StrikeDeclaration) as (keyof StrikeDeclared)[]
const STRIKE_MODIFIER_KEYS = Object.keys(StrikeModifiersSchema.shape) as (keyof StrikeDeclared['modifiers'])[]
const SHOT_KEYS = Object.keys(ShotDeclaration) as (keyof ShotDeclared)[]
const AIM_KEYS = Object.keys(AttackAim) as (keyof Aimed)[]
const MADE_KEYS = Object.keys(AttackMade) as (keyof Made)[]

function pick<T, K extends keyof T>(from: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, from[k]])) as Pick<T, K>
}

export function pickStrikeDeclaration(from: StrikeDeclared): StrikeDeclared {
  return { ...pick(from, STRIKE_KEYS), modifiers: pick(from.modifiers, STRIKE_MODIFIER_KEYS) }
}

export function pickShotDeclaration(from: ShotDeclared): ShotDeclared {
  return pick(from, SHOT_KEYS)
}

// What the attack is made with alone, the row and the variation: what a cut
// swings, and what a sweep's later strikes go on with — the rest of the
// declaration went with the blow it was declared with, once.
export function pickMade(from: Made): Made {
  return pick(from, MADE_KEYS)
}

export function pickAim(from: Aimed): Aimed {
  return pick(from, AIM_KEYS)
}
