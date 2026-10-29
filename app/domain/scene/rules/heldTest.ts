import type { Character } from '../../types'
import { CALLED_TESTS } from '../../lists'
import type { SceneState, HeldRoll, HeldTest } from '../types'
import { getAfflictions, isDead } from '../../character/rules/afflictions'
import { sumTerms, type Term } from '../../character/rules/terms'
import type { RollMode } from '../../play/dice'
import type { Test } from '../../play/test'
import type { HeldKind } from './heldRoll'
import { getSituationalAfflictions } from './situational'
import { getSwimTestTerms, getWaterOf } from './swim'
import { getStealthTerms } from '../../character/rules/skills'
import { getDegree } from '../../play/test'
import { isParked } from './parked'

export type CalledKind = (typeof CALLED_TESTS)[number]

export function isCalledKind(kind: HeldKind): kind is CalledKind {
  return (CALLED_TESTS as readonly HeldKind[]).includes(kind)
}

// Tests a character makes once a round and then scores against every DL the
// round puts to them. The round calls whoever the kind says it must at its
// beginning; a test the character comes to need mid-round is an action of its
// own, opened by the one that brought them to it (`openSwimTest`), or the die
// of the move that needs it (a climb, a walk across difficult ground).
type HeldDef = {
  called: (state: SceneState, id: string) => boolean
  skill: (c: Character) => Term[]
  // The DL of the test at the moment a call is rolled.
  DL: (state: SceneState, id: string) => number
  // play.tex "Safe and risky tests": "can only be used when indicated in the
  // skill or ability or when the GM allows it".
  modes: (c: Character) => readonly RollMode[]
  // Whether the score is made against a DL; a stealth value is a score the
  // round's detections are held against, with no DL of its own.
  versus: boolean
}

const HELD_DEFS: Record<CalledKind, HeldDef> = {
  // combat.tex "Swimming": "While in the water, make a swimming check against
  // the DL of the body of water."
  swim: {
    called: (state, id) => getWaterOf(state, id) !== null,
    skill: getSwimTestTerms,
    DL: (state, id) => getWaterOf(state, id)?.DL ?? 0,
    modes: () => ['normal'],
    versus: true,
  },
  // combat.tex "Stealth in combat": "The stealth value is rolled for each
  // character individually, when needed. Only one test per round is made" —
  // rolled for everyone as the round begins, which is when the table's tool
  // rolls it (the table's ruling).
  stealth: {
    called: () => true,
    skill: getStealthTerms,
    DL: () => 0,
    modes: () => ['normal'],
    versus: false,
  },
}

// The test as it was made, for the table to read.
export function describeHeld(kind: CalledKind, roll: HeldRoll, DL: number): string {
  const made = `${roll.mode} · ${kind} ${roll.skill} + die ${roll.die} = ${roll.score}`
  return HELD_DEFS[kind].versus ? `${made} vs DL ${DL} → ${getDegree(roll.score, DL)}` : made
}

// The DL a test is made against, null for one with none.
export function getHeldDL(state: SceneState, id: string, kind: CalledKind): number | null {
  return HELD_DEFS[kind].versus ? HELD_DEFS[kind].DL(state, id) : null
}

export function getHeldModes(c: Character, kind: CalledKind): readonly RollMode[] {
  return HELD_DEFS[kind].modes(c)
}

// Whether a kind of test is due from a character: the living and awake whose
// situation calls for it.
export function isHeldCalled(state: SceneState, id: string, kind: CalledKind): boolean {
  const c = state.characters[id]
  return !!c && HELD_DEFS[kind].called(state, id) && !isDead(c) && !getAfflictions(c, getSituationalAfflictions(state, id)).includes('unconscious')
}

// Who the beginning of the round calls to which tests.
export function getHeldCalled(state: SceneState): HeldTest[] {
  return CALLED_TESTS.flatMap((kind) =>
    Object.keys(state.characters)
      .filter((id) => !isParked(state, id) && isHeldCalled(state, id, kind))
      .map((id) => ({ id, kind, roll: null })),
  )
}

// The test a call is rolled as.
export function getHeldTest(state: SceneState, id: string, kind: CalledKind): Test | null {
  const c = state.characters[id]
  if (!c) return null
  const skill = HELD_DEFS[kind].skill(c)
  const DL = HELD_DEFS[kind].DL(state, id)
  return { skill: sumTerms(skill), DL, explodes: false, scale: 'degrees', terms: { skill, DL: [{ label: kind, value: DL }] } }
}
