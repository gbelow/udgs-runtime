import { create } from 'zustand'
import { BoardMapSchema, type BoardMap } from '../domain/scene/types'
import type { BoardMapUpdater } from '../domain/scene/commands/boardMapEdit'

// The Battle maps tab is an editor: the map being made or changed, and the
// kept one it was opened from, if any. There is always one to edit.
type BoardMapDraftStore = {
  openId: string | null
  map: BoardMap
  open: (id: string | null, map: BoardMap) => void
  updateMap: (updater: BoardMapUpdater) => void
}

const createDraftStore = () => create<BoardMapDraftStore>((set, get) => ({
  openId: null,
  map: BoardMapSchema.parse({}),
  open: (openId, map) => set({ openId, map }),
  updateMap: (updater) => set({ map: updater(get().map) }),
}))

export const useBoardMapDraftStore = createDraftStore()

// The Structures tab edits a structure the same way, as a small battle map
// around its anchor.
export const useStructureDraftStore = createDraftStore()
