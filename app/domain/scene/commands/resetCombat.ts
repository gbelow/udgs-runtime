import type { SceneState } from '../types'

// Empties the fight: nobody in it, nothing on the floor or in the action log,
// back to round 0. The board's ground is kept; only who stands on it goes.
export function resetCombat(state: SceneState): SceneState {
  return {
    ...state,
    characters: {},
    activeCharacterId: null,
    inTurnCharacter: '',
    forcedSurge: '',
    turn: 0,
    turnsBegun: 0,
    contenders: [],
    lastContest: null,
    agreedToEnd: [],
    morale: [],
    stress: [],
    heldTests: [],
    turnsTaken: [],
    prepared: [],
    stealthTurns: [],
    bodyCover: {},
    pressure: [],
    tablePressure: {},
    surrendered: [],
    round: 0,
    actions: [],
    stack: [],
    record: [],
    names: {},
    journal: [],
    edits: [],
    board: state.board ? { ...state.board, placements: {} } : null,
    binds: [],
    floor: [],
  }
}
