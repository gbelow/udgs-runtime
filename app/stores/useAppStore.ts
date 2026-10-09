import { createStore } from "zustand/vanilla";
import { toast } from "sonner";
import { getBasicCharList, getCharacterList, getMapList, getRaceList, JsonObject } from "../actions";
import { useContext } from "react";
import { AppStoreContext } from "./appStoreProvider";
import { useStore } from "zustand";
import type { Trade } from "../domain/item/rules/trade";

export type GameTabs = 'create' | 'edit' | 'race' | 'map' | 'party' | 'play' | 'break' | 'catalog'

// The store that holds each tab's active character: the one being edited, the
// race being made, the party's, the fight's — or none, for a tab whose
// character is not a sheet.
export type TabOwner = 'character' | 'race' | 'campaign' | 'combat' | null

export const TAB_OWNER: Record<GameTabs, TabOwner> = {
  create: null,
  edit: 'character',
  race: 'race',
  map: null,
  party: 'campaign',
  play: 'combat',
  break: 'combat',
  catalog: 'combat',
}

export function isFightTab(tab: GameTabs): boolean {
  return TAB_OWNER[tab] === 'combat'
}

// The item waiting for a destination to be clicked: a catalog entry picked in
// the sidebar, at the size it is to be stamped at, a stack in the hands being
// put away, or the armor being taken off. Pure UI coordination between
// components; what it is and where it fits are the domain's to say.
export type PendingItem =
  | { source: 'catalog'; key: string; amount: number; scale: number }
  | { source: 'hand'; itemId: string }
  | { source: 'worn' }

export interface AppState {
  // the trade being put together with a merchant, or null while not trading
  trade: Trade | null
  setTrade: (trade: Trade | null) => void
  selectedGameTab: GameTabs
  setSelectedGameTab: (mode: GameTabs) => void
  baseCharacterList: JsonObject
  updateBaseCharacterList: () => void
  playerCharacterList: {id: string, name: string}[]
  updatePlayerCharacterList: () => void
  raceList: JsonObject
  updateRaceList: () => void
  mapList: JsonObject
  updateMapList: () => void
  pendingItem: PendingItem | null
  setPendingItem: (pendingItem: PendingItem | null) => void
}

export const createAppStore = (initialState: Partial<AppState>) =>
  createStore<AppState>((set) => ({
    selectedGameTab: 'edit',
    baseCharacterList: initialState.baseCharacterList || {},
    playerCharacterList: initialState.playerCharacterList || [],
    raceList: initialState.raceList || {},
    mapList: initialState.mapList || {},
    
    setSelectedGameTab: (selectedGameTab) => set({ selectedGameTab }),
    pendingItem: null,
    setPendingItem: (pendingItem) => set({ pendingItem }),
    trade: null,
    setTrade: (trade) => set({ trade }),
    
    updateBaseCharacterList: async () => {
      const res = await getBasicCharList()
      if (!res.ok) { toast.error(res.error); return }
      set(s=> ({...s, baseCharacterList: res.data}) )
    },

    updateRaceList: async () => {
      const res = await getRaceList()
      if (!res.ok) { toast.error(res.error); return }
      set(s=> ({...s, raceList: res.data}) )
    },

    updateMapList: async () => {
      const res = await getMapList()
      if (!res.ok) { toast.error(res.error); return }
      set(s=> ({...s, mapList: res.data}) )
    },

    updatePlayerCharacterList: async () => {
      const res = await getCharacterList()
      if (!res.ok) { toast.error(res.error); return }
      set(s=> ({...s, playerCharacterList: res.data}) )
    },

  })
);

export function useAppStore<T>(selector: (state: AppState) => T) {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error("Missing AppStoreProvider");
  return useStore(store, selector);
}