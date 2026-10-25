import type { SetStateAction } from 'react'
import { create } from 'zustand'
import { EXPLOSION_DRAFT, type ExplosionDraft } from '../domain/scene/rules/impose'

export type FloorTool = 'put' | 'remove' | 'explode' | 'charge' | 'setoff'

// The GM's tool for the floor of the board, picked beside the actions and
// used by clicking the board, and the explosion it is described with.
type FloorToolStore = {
  floorTool: FloorTool | null
  setFloorTool: (floorTool: FloorTool | null) => void
  explosion: ExplosionDraft
  setExplosion: (explosion: SetStateAction<ExplosionDraft>) => void
}

export const useFloorToolStore = create<FloorToolStore>((set) => ({
  floorTool: null,
  setFloorTool: (floorTool) => set({ floorTool }),
  explosion: EXPLOSION_DRAFT,
  setExplosion: (explosion) => set((s) => ({ explosion: typeof explosion === 'function' ? explosion(s.explosion) : explosion })),
}))
