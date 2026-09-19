import { createStore } from "zustand/vanilla";
import { toast } from "sonner";
import { getBasicCharList, getCharacterList, JsonObject } from "../actions";
import { useContext } from "react";
import { AppStoreContext } from "./appStoreProvider";
import { useStore } from "zustand";

export type GameTabs = 'edit' | 'play' | 'break' | 'catalog'

// The item waiting for a destination to be clicked: a catalog entry picked in
// the sidebar, at the size it is to be stamped at, a stack in the hands being
// put away, or the armor being taken off. Pure UI coordination between
// components; what it is and where it fits are the domain's to say.
export type PendingItem =
  | { source: 'catalog'; key: string; amount: number; scale: number }
  | { source: 'hand'; itemId: string }
  | { source: 'worn' }

export interface AppState {
  selectedGameTab: GameTabs
  setSelectedGameTab: (mode: GameTabs) => void
  baseCharacterList: JsonObject
  updateBaseCharacterList: () => void
  playerCharacterList: {id: string, name: string}[]
  updatePlayerCharacterList: () => void
  pendingItem: PendingItem | null
  setPendingItem: (pendingItem: PendingItem | null) => void
}

export const createAppStore = (initialState: Partial<AppState>) =>
  createStore<AppState>((set) => ({
    selectedGameTab: 'edit',
    baseCharacterList: initialState.baseCharacterList || {},
    playerCharacterList: initialState.playerCharacterList || [],
    
    setSelectedGameTab: (selectedGameTab) => set({ selectedGameTab }),
    pendingItem: null,
    setPendingItem: (pendingItem) => set({ pendingItem }),
    
    updateBaseCharacterList: async () => {
      const res = await getBasicCharList()
      if (!res.ok) { toast.error(res.error); return }
      set(s=> ({...s, baseCharacterList: res.data}) )
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