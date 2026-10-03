import type { Character } from '../../types'
import type { CombatState, HeldTest } from '../types'
import { getAfflictions, isDead } from '../../character/rules/afflictions'
import { sumTerms, type Term } from '../../character/rules/terms'
import type { RollMode } from '../dice'
import type { Test } from './test'
import type { HeldKind } from './heldRoll'
import { getSituationalAfflictions } from './situational'
import { getSwimTestTerms, getWaterOf } from './swim'

// Tests a character makes once a round and then scores against every DL the
// round puts to them. The round calls whoever the kind says it must at its
// beginning; a test the character comes to need mid-round is rolled with the
// action that needs it (see `rules/swim.ts` `needsSwimTest`).
type HeldDef = {
  called: (state: CombatState, id: string) => boolean
  skill: (c: Character) => Term[]
  // The DL of the test at the moment a call is rolled.
  DL: (state: CombatState, id: string) => number
  // play.tex "Safe and risky tests": "can only be used when indicated in the
  // skill or ability or when the GM allows it".
  modes: (c: Character) => readonly RollMode[]
}

const HELD_DEFS: Record<HeldKind, HeldDef> = {
  // combat.tex "Swimming": "While in the water, make a swimming check against
  // the DL of the body of water."
  swim: {
    called: (state, id) => getWaterOf(state, id) !== null,
    skill: getSwimTestTerms,
    DL: (state, id) => getWaterOf(state, id)?.DL ?? 0,
    modes: () => ['normal'],
  },
}

export function getHeldModes(c: Character, kind: HeldKind): readonly RollMode[] {
  return HELD_DEFS[kind].modes(c)
}

// Who the beginning of the round calls to which tests: the living and awake
// whose kind of test is due.
export function getHeldCalled(state: CombatState): HeldTest[] {
  return (Object.keys(HELD_DEFS) as HeldKind[]).flatMap((kind) =>
    Object.keys(state.characters)
      .filter((id) => {
        const c = state.characters[id]
        return HELD_DEFS[kind].called(state, id) && !isDead(c) && !getAfflictions(c, getSituationalAfflictions(state, id)).includes('unconscious')
      })
      .map((id) => ({ id, kind, roll: null })),
  )
}

// The test a call is rolled as.
export function getHeldTest(state: CombatState, id: string, kind: HeldKind): Test | null {
  const c = state.characters[id]
  return c ? { skill: sumTerms(HELD_DEFS[kind].skill(c)), DL: HELD_DEFS[kind].DL(state, id), explodes: false, scale: 'degrees' } : null
}
