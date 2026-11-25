import { create } from 'zustand'
import type { SceneState, Updater } from '../domain/scene/types'
import { holdForDice } from '../domain/play/calls'
import { getSceneSeenBy } from '../domain/scene/projections/seen'
import { useCampaignStore } from './useCampaignStore'
import { useCombatStore } from './useCombatStore'

// The whole fight, on a screen that keeps a table of its own for someone who
// is shown only part of it (the demo): every command is judged and played here,
// and the combat store, which every panel reads, holds what `viewer` is shown
// of it, as a guest's does. Null everywhere else: the combat store is the fight.
type KeptFight = { scene: SceneState | null; viewer: string }

export const useKeptFight = create<KeptFight>(() => ({ scene: null, viewer: '' }))

const called = (s: SceneState) => [s.calls]

useKeptFight.subscribe(({ scene, viewer }) => {
  if (!scene) return
  const { owners } = useCampaignStore.getState()
  useCombatStore.setState(getSceneSeenBy(scene, new Set(Object.keys(scene.characters).filter((id) => owners[id] === viewer))))
})

// The fight as it stands, whatever the screen is shown of it.
export const readFight = (): SceneState => useKeptFight.getState().scene ?? useCombatStore.getState()

export function updateFight(updater: Updater) {
  const { scene } = useKeptFight.getState()
  if (scene) useKeptFight.setState({ scene: holdForDice(called, scene, updater(scene)) })
  else useCombatStore.getState().updateCombatState(updater)
}

export const keepFight = (scene: SceneState, viewer: string) => useKeptFight.setState({ scene, viewer })
export const dropFight = () => useKeptFight.setState({ scene: null, viewer: '' })

// Told of every change to the fight.
export function subscribeFight(told: () => void): () => void {
  const offKept = useKeptFight.subscribe(told)
  const offShown = useCombatStore.subscribe(told)
  return () => { offKept(); offShown() }
}

// Read off the fight as it stands, kept up to date.
export function useFight<T>(select: (state: SceneState) => T): T {
  const kept = useKeptFight((s) => s.scene !== null)
  const whole = useKeptFight((s) => (s.scene ? select(s.scene) : null))
  const shown = useCombatStore(select)
  return kept ? whole as T : shown
}

// Whether the screen is shown only part of the fight it keeps.
export const useKeepsFight = (): boolean => useKeptFight((s) => s.scene !== null)
