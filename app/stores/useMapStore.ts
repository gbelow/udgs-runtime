import { create } from 'zustand'
import { CrawlMapSchema, type CrawlMap, type MapUpdater } from '../domain/campaign/types'

// The map tab is a map *editor*: the point crawl being made, opened from the
// saved maps or begun anew. There is always one to edit.
type MapStore = {
  map: CrawlMap
  loadMap: (raw: unknown) => void
  updateMap: (updater: MapUpdater) => void
  newMap: () => void
}

export const useMapStore = create<MapStore>((set, get) => ({
  map: CrawlMapSchema.parse({}),
  loadMap: (raw) => set({ map: CrawlMapSchema.parse(raw) }),
  updateMap: (updater) => set({ map: updater(get().map) }),
  newMap: () => set({ map: CrawlMapSchema.parse({}) }),
}))
