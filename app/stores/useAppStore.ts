import { createStore } from "zustand/vanilla";
import { getBasicCharList, getCharacterList, JsonObject } from "../actions";
import { useContext } from "react";
import { AppStoreContext } from "./appStoreProvider";
import { useStore } from "zustand";

type GameTabs = 'edit' | 'play' 

export interface AppState {
  selectedGameTab: GameTabs
  setSelectedGameTab: (mode: GameTabs) => void
  baseCharacterList: JsonObject
  updateBaseCharacterList: () => void
  playerCharacterList: {id: string, name: string}[]
  updatePlayerCharacterList: () => void  
}

export const createAppStore = (initialState: Partial<AppState>) =>
  createStore<AppState>((set) => ({
    selectedGameTab: 'edit',
    baseCharacterList: initialState.baseCharacterList || {},
    playerCharacterList: initialState.playerCharacterList || [],
    
    setSelectedGameTab: (selectedGameTab) => set({ selectedGameTab }),
    
    updateBaseCharacterList: async () => {
      try {
        const baseCharacterList = await getBasicCharList()
        set(s=> ({...s, baseCharacterList}) )
      }catch(err){
        console.log(err)
      }
    },

    updatePlayerCharacterList: async () => {
      try {
        const playerCharacterList = await getCharacterList()
        set(s=> ({...s, playerCharacterList}) )
      }catch(err){
        console.log(err)
      }
    },

  })
);

export function useAppStore<T>(selector: (state: AppState) => T) {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error("Missing AppStoreProvider");
  return useStore(store, selector);
}