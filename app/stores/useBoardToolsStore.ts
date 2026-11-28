import { create } from 'zustand'
import type { TerrainBrush } from '../domain/types'
import type { SurfaceTarget } from '../domain/scene/types'
import { useFloorToolStore } from './useFloorToolStore'

// The GM's board tools, picked in the GM tab beside the catalogs and used by
// clicking the board: whether the tab is open (`open`), the terrain brush
// held, the surface being laid (with the art frozen to and where it goes),
// how wide either reaches, and whether a click puts the active character
// down anywhere. Each pick puts the others down; closing the tab puts down
// all of them, the floor tool too.
type BoardToolsStore = {
  open: boolean
  brush: TerrainBrush | null
  laying: string | null
  frozen: string | null
  onto: SurfaceTarget
  radius: number
  reposition: boolean
  setOpen: (open: boolean) => void
  setBrush: (brush: TerrainBrush | null) => void
  setLaying: (laying: string | null) => void
  setFrozen: (frozen: string | null) => void
  setOnto: (onto: SurfaceTarget) => void
  setRadius: (radius: number) => void
  setReposition: (reposition: boolean) => void
}

export const useBoardToolsStore = create<BoardToolsStore>((set) => ({
  open: false,
  brush: null,
  laying: null,
  frozen: null,
  onto: 'ground',
  radius: 0,
  reposition: false,
  setOpen: (open) => {
    if (!open) useFloorToolStore.getState().setFloorTool(null)
    set(open ? { open } : { open, brush: null, laying: null, reposition: false })
  },
  setBrush: (brush) => {
    useFloorToolStore.getState().setFloorTool(null)
    set({ brush, laying: null, reposition: false })
  },
  setLaying: (laying) => {
    useFloorToolStore.getState().setFloorTool(null)
    set({ laying, frozen: null, brush: null, reposition: false })
  },
  setFrozen: (frozen) => set({ frozen }),
  setOnto: (onto) => set({ onto }),
  setRadius: (radius) => set({ radius }),
  setReposition: (reposition) => {
    useFloorToolStore.getState().setFloorTool(null)
    set({ reposition, brush: null, laying: null })
  },
}))
