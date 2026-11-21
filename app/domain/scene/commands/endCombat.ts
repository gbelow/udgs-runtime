import type { SceneState, Updater } from '../types'
import type { Caller, Throw } from '../../play/calls'
import { calling } from './calling'
import { leaveFight, tendAfterFight } from '../../character/commands/leaveFight'
import { getAfterFightTest } from '../rules/medicine'
import { isDead } from '../../character/rules/afflictions'
import type { CampaignCharacter, Degree } from '../../types'
import { updateCharacter } from './characters'
import { expireUsedAbilities } from '../../character/commands/abilities'
import { getHeldActions } from '../rules/hold'
import { getEndCombatBar } from '../rules/fight'
import { finishHeld } from './hold'
import { meetSurrendersSpared } from './providence'

// The combat or chase ends and everyone stays in the scene: what the end of a
// fight does to each (`leaveFight`), and the scene goes back to before its
// first round with nothing the rounds held. What was held over finishes, in
// the order of the cunning tests, for nothing. The log stays.
export function endCombat(thrown: Throw): Updater {
  return calling({ kind: 'endCombat' }, thrown, (caller) => (state) => (getEndCombatBar(state) ? state : endScene(state, caller)))
}

// combat.tex "Bleed": "When combat/chase ends, make a tend wounds test",
// everyone still bleeding on their own die; null for one who bleeds no more.
function getTended(state: SceneState, caller: Caller, c: CampaignCharacter): Degree | null {
  if (isDead(c) || c.injuries.bleed === 0) return null
  return caller.test({ id: `tendWounds:${c.id}`, roller: c.id, label: 'tend wounds', test: getAfterFightTest(state, c) })?.degree ?? 'miss'
}

// The combat ends, whatever ended it: the table, or a chase that is over.
// Whoever still bleeds tends their wounds first, each noted in the log.
export function endScene(scene: SceneState, caller: Caller): SceneState {
  const spared = meetSurrendersSpared(scene)
  const state = Object.values(spared.characters).reduce((s, c) => {
    const degree = getTended(spared, caller, c)
    return degree ? updateCharacter(c.id, tendAfterFight(degree), `tend wounds after the fight: ${degree}`)(s) : s
  }, spared)
  const characters = Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, leaveFight(expireUsedAbilities(c))]))
  const ended = {
    ...state,
    characters,
    surrenderers: [],
    compelledSurrender: [],
    braved: [],
    moraleRallies: [],
    round: 0,
    roundStep: null,
    chase: null,
    chaseIntents: {},
    inTurnCharacter: '',
    forcedSurge: '',
    forcedBy: '',
    fleeing: false,
    turnQueue: [],
    fleers: [],
    contenders: [], contestModes: {},
    lastContest: null,
    agreedToEnd: [],
    concentration: [],
    morale: [],
    compulsions: [],
    heldTests: [],
    turnsTaken: [],
    prepared: [],
    performed: [],
    protectionMoves: [],
    mocked: [],
    dominations: [],
    firstTurn: null,
    following: {},
    stealthTurns: [],
    pressure: [],
  }
  return finishHeld(ended, getHeldActions(ended).map((h) => h.id), caller)
}
