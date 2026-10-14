import { createStore } from "zustand/vanilla";
import { toast } from "sonner";
import { getBasicCharList, getCharacterList, getMapList, getRaceList, JsonObject } from "../actions";
import { useContext } from "react";
import { AppStoreContext } from "./appStoreProvider";
import { useStore } from "zustand";
import type { Trade } from "../domain/item/rules/trade";

export type GameTabs = 'create' | 'edit' | 'race' | 'map' | 'scene' | 'exploration' | 'downtime' | 'break' | 'catalog' | 'campaign'

// The run screen's modes, one per sequence that moves time: each is a tab of
// its own, so the store that owns the active character stays the tab's.
export const RUN_TABS = ['scene', 'exploration', 'downtime'] as const
export type RunTab = typeof RUN_TABS[number]

export function isRunTab(tab: GameTabs): tab is RunTab {
  return (RUN_TABS as readonly string[]).includes(tab)
}

// The catalog's editors that hold a sheet of their own are tabs of their own
// too, for the same reason: the races, made as characters, and the maps.
const CATALOG_TABS = ['catalog', 'race', 'map'] as const

export function isCatalogTab(tab: GameTabs): boolean {
  return (CATALOG_TABS as readonly string[]).includes(tab)
}

// The store that holds each tab's active character: the one being edited, the
// one being made by the book's steps, the race being made, the party's, the
// fight's — or none, for a tab whose character is not a sheet.
export type TabOwner = 'character' | 'creation' | 'race' | 'campaign' | 'combat' | null

export const TAB_OWNER: Record<GameTabs, TabOwner> = {
  create: 'creation',
  edit: 'character',
  race: 'race',
  map: null,
  scene: 'combat',
  exploration: 'campaign',
  downtime: 'campaign',
  break: 'combat',
  catalog: 'combat',
  campaign: 'campaign',
}

export function isFightTab(tab: GameTabs): boolean {
  return TAB_OWNER[tab] === 'combat'
}

// Who is at the screen. A player only follows the standard rules; the GM and
// the developer may also switch the run screen to GM mode, where the GM's
// tools and catalogs open and the rules a character is held to are lifted.
// Only dev exists until there are accounts.
export type Role = 'player' | 'gm' | 'dev'

export function hasGmTools(role: Role): boolean {
  return role !== 'player'
}

// Whether the screen acts as the GM: the switch is on and the role has it.
export function isActingAsGm(state: Pick<AppState, 'role' | 'gmMode'>): boolean {
  return hasGmTools(state.role) && state.gmMode
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
  // the run screen's mode last shown, opened again when the run screen is
  runTab: RunTab
  // the days typed for downtime's coming stretch, or null for as long as the
  // longest plan
  downtimeSpan: number | null
  setDowntimeSpan: (downtimeSpan: number | null) => void
  baseCharacterList: JsonObject
  updateBaseCharacterList: () => void
  playerCharacterList: {id: string, name: string}[]
  updatePlayerCharacterList: () => void
  raceList: JsonObject
  updateRaceList: () => void
  mapList: JsonObject
  updateMapList: () => void
  role: Role
  gmMode: boolean
  setGmMode: (gmMode: boolean) => void
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
    
    runTab: 'scene',
    downtimeSpan: null,
    setDowntimeSpan: (downtimeSpan) => set({ downtimeSpan }),
    setSelectedGameTab: (selectedGameTab) => set(isRunTab(selectedGameTab) ? { selectedGameTab, runTab: selectedGameTab } : { selectedGameTab }),
    role: 'dev',
    gmMode: false,
    setGmMode: (gmMode) => set({ gmMode }),
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