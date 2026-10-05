import type { Character } from '../../types'
import { CALLED_TESTS } from '../../lists'
import type { CombatState, HeldTest } from '../types'
import { getAfflictions, isDead } from '../../character/rules/afflictions'
import { sumTerms, type Term } from '../../character/rules/terms'
import type { RollMode } from '../dice'
import type { Test } from './test'
import type { HeldKind } from './heldRoll'
import { getSituationalAfflictions } from './situational'
import { getSwimTestTerms, getWaterOf } from './swim'

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
  called: (state: CombatState, id: string) => boolean
  skill: (c: Character) => Term[]
  // The DL of the test at the moment a call is rolled.
  DL: (state: CombatState, id: string) => number
  // play.tex "Safe and risky tests": "can only be used when indicated in the
  // skill or ability or when the GM allows it".
  modes: (c: Character) => readonly RollMode[]
}

const HELD_DEFS: Record<CalledKind, HeldDef> = {
  // combat.tex "Swimming": "While in the water, make a swimming check against
  // the DL of the body of water."
  swim: {
    called: (state, id) => getWaterOf(state, id) !== null,
    skill: getSwimTestTerms,
    DL: (state, id) => getWaterOf(state, id)?.DL ?? 0,
    modes: () => ['normal'],
  },
}

export function getHeldModes(c: Character, kind: CalledKind): readonly RollMode[] {
  return HELD_DEFS[kind].modes(c)
}

// Whether a kind of test is due from a character: the living and awake whose
// situation calls for it.
export function isHeldCalled(state: CombatState, id: string, kind: CalledKind): boolean {
  const c = state.characters[id]
  return !!c && HELD_DEFS[kind].called(state, id) && !isDead(c) && !getAfflictions(c, getSituationalAfflictions(state, id)).includes('unconscious')
}

// Who the beginning of the round calls to which tests.
export function getHeldCalled(state: CombatState): HeldTest[] {
  return CALLED_TESTS.flatMap((kind) =>
    Object.keys(state.characters)
      .filter((id) => isHeldCalled(state, id, kind))
      .map((id) => ({ id, kind, roll: null })),
  )
}

// The test a call is rolled as.
export function getHeldTest(state: CombatState, id: string, kind: CalledKind): Test | null {
  const c = state.characters[id]
  if (!c) return null
  const skill = HELD_DEFS[kind].skill(c)
  const DL = HELD_DEFS[kind].DL(state, id)
  return { skill: sumTerms(skill), DL, explodes: false, scale: 'degrees', terms: { skill, DL: [{ label: kind, value: DL }] } }
}
