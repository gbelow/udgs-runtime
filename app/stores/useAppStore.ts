import { createStore } from "zustand/vanilla";
import { toast } from "sonner";
import { getBasicCharList, getBoardMapList, getCampaignList, getCharacterList, getCollectionList, getMapList, getProfileList, getRaceList, JsonObject } from "../actions";
import { useContext } from "react";
import { AppStoreContext } from "./appStoreProvider";
import { useStore } from "zustand";
import type { Trade } from "../domain/item/rules/trade";
import type { CampaignRow, Profile, ProfileListing } from "../domain/profiles";
import type { Collection } from "../domain/campaign/types";
import type { SavedBoardMap } from "../domain/scene/types";
import { without } from "../domain/utils";

export type GameTabs = 'create' | 'edit' | 'race' | 'map' | 'boards' | 'collections' | 'scene' | 'exploration' | 'downtime' | 'break' | 'catalog' | 'campaign'

// The run screen's modes, one per sequence that moves time: each is a tab of
// its own, so the store that owns the active character stays the tab's.
export const RUN_TABS = ['scene', 'exploration', 'downtime'] as const
export type RunTab = typeof RUN_TABS[number]

export function isRunTab(tab: GameTabs): tab is RunTab {
  return (RUN_TABS as readonly string[]).includes(tab)
}

// The catalog's editors that hold a sheet of their own are tabs of their own
// too, for the same reason: the races, made as characters, and the maps.
const CATALOG_TABS = ['catalog', 'race', 'map', 'boards', 'collections'] as const

// The character editor's parts, each a tab of its own within it.
export const EDITOR_TABS = ['body', 'trainables', 'gear'] as const
export type EditorTab = typeof EDITOR_TABS[number]

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
  boards: null,
  collections: null,
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
  // the character editor's part last shown
  editorTab: EditorTab
  setEditorTab: (editorTab: EditorTab) => void
  // the race each edited character is measured against, by character id;
  // nothing of the character changes with it
  raceBaselines: Record<string, string>
  setRaceBaseline: (characterId: string, race: string | null) => void
  // the days typed for downtime's coming stretch, or null for as long as the
  // longest plan
  downtimeSpan: number | null
  setDowntimeSpan: (downtimeSpan: number | null) => void
  baseCharacterList: JsonObject
  updateBaseCharacterList: () => void
  playerCharacterList: {id: string, name: string, owner: string}[]
  updatePlayerCharacterList: () => void
  raceList: JsonObject
  updateRaceList: () => void
  mapList: JsonObject
  updateMapList: () => void
  // the battle maps kept: the developer's and the profile's own, by id
  boardMaps: Record<string, SavedBoardMap>
  updateBoardMaps: () => void
  // the profile picked at this screen, or null before one is
  profile: Profile | null
  setProfile: (profile: Profile) => void
  profileList: ProfileListing[]
  updateProfileList: () => void
  // the collections the profile sees, by id: their own and those shared
  // with them or with a campaign they play
  collections: Record<string, Collection>
  putCollection: (collection: Collection) => void
  dropCollection: (id: string) => void
  updateCollections: () => void
  // every saved campaign, as the profile sees it
  campaignList: CampaignRow[]
  updateCampaignList: () => void
  // whether this is the dev server, where whoever is at the screen is the
  // developer
  devServer: boolean
  // whether the GM's tools, for a role that has them, are switched on: GM
  // mode, where the GM's catalogs open and the rules a character is held to
  // are lifted
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
    boardMaps: initialState.boardMaps || {},

    runTab: 'scene',
    editorTab: 'body',
    setEditorTab: (editorTab) => set({ editorTab }),
    raceBaselines: {},
    setRaceBaseline: (characterId, race) => set((s) => {
      const raceBaselines = { ...s.raceBaselines }
      if (race) raceBaselines[characterId] = race
      else delete raceBaselines[characterId]
      return { raceBaselines }
    }),
    downtimeSpan: null,
    setDowntimeSpan: (downtimeSpan) => set({ downtimeSpan }),
    setSelectedGameTab: (selectedGameTab) => set(isRunTab(selectedGameTab) ? { selectedGameTab, runTab: selectedGameTab } : { selectedGameTab }),
    profile: initialState.profile ?? null,
    setProfile: (profile) => set({ profile }),
    profileList: initialState.profileList || [],
    collections: initialState.collections || {},
    putCollection: (collection) => set((s) => ({ collections: { ...s.collections, [collection.id]: collection } })),
    dropCollection: (id) => set((s) => ({ collections: without(s.collections, id) })),
    campaignList: initialState.campaignList || [],
    devServer: initialState.devServer ?? false,
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

    updateBoardMaps: async () => {
      const res = await getBoardMapList()
      if (!res.ok) { toast.error(res.error); return }
      set({ boardMaps: res.data })
    },

    updatePlayerCharacterList: async () => {
      const res = await getCharacterList()
      if (!res.ok) { toast.error(res.error); return }
      set(s=> ({...s, playerCharacterList: res.data}) )
    },

    updateCollections: async () => {
      const res = await getCollectionList()
      if (!res.ok) { toast.error(res.error); return }
      set({ collections: res.data })
    },

    updateCampaignList: async () => {
      const res = await getCampaignList()
      if (!res.ok) { toast.error(res.error); return }
      set({ campaignList: res.data })
    },

    updateProfileList: async () => {
      const res = await getProfileList()
      if (!res.ok) { toast.error(res.error); return }
      set({ profileList: res.data })
    },

  })
);

export function useAppStore<T>(selector: (state: AppState) => T) {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error("Missing AppStoreProvider");
  return useStore(store, selector);
}
// The store itself, for a handler that reads it as of the click rather than
// subscribing to it.
export function useAppStoreApi() {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error("Missing AppStoreProvider");
  return store;
}
