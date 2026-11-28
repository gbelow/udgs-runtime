import { create } from 'zustand'

// Where things on the run screen begin down the screen, in pixels, as they
// last measured themselves: the board's canvas (under the board's own tools)
// and the box of the character's state in the bottom left corner; null while
// either is not drawn.
type Edge = 'board' | 'state'
type ScreenEdgesStore = { board: number | null; state: number | null; setEdge: (edge: Edge, top: number | null) => void }

export const useScreenEdgesStore = create<ScreenEdgesStore>((set) => ({
  board: null,
  state: null,
  setEdge: (edge, top) => set((s) => (s[edge] === top ? s : { [edge]: top })),
}))
