import { createContext, useContext, useMemo } from "react";
import { toast } from "sonner";
import type { Connection, CrawlEvent, CrawlNode, EventOwner, EventType, MapUpdater, TerrainTag, TerrainValues, TerrainWear, Way } from "../domain/campaign/types";
import { getCampaignMapEditorView, getMapEditorView, type MapEditorView } from "../domain/campaign/projections/map";
import { updateCampaignMap } from "../domain/campaign/commands/parties";
import {
  addConnection, addEvent, addNode, customizeNode, customizeNodeWear, removeConnection, removeEvent, removeNode, resetNodeValue, setConnection, setEnabler,
  setEvent, setEventWay, setMapName, setNode, setSettlementLiving, toggleEventType, toggleSettlement, toggleNodeTag,
} from "../domain/campaign/commands/map";
import { deleteMap, upsertMap } from "../actions";
import { useAppStore } from "../stores/useAppStore";
import { useMapStore } from "../stores/useMapStore";
import { useCampaignStore } from "../stores/useCampaignStore";

// The saved maps, by name.
export function useMapNames(): { mapList: Record<string, unknown>; maps: string[] } {
  const mapList = useAppStore((s) => s.mapList);
  const maps = useMemo(() => Object.keys(mapList).sort(), [mapList]);
  return { mapList, maps };
}

// survival.tex "Creating the point crawl": the map tab — the map being made,
// opened from the saved maps or begun anew, changed, and saved.
export function useMapEditor() {
  const map = useMapStore((s) => s.map);
  const update = useMapStore((s) => s.updateMap);
  const loadMap = useMapStore((s) => s.loadMap);
  const newMap = useMapStore((s) => s.newMap);
  const refresh = useAppStore((s) => s.updateMapList);
  const { mapList, maps } = useMapNames();
  const view: MapEditorView = useMemo(() => getMapEditorView(map), [map]);

  const open = (name: string) => {
    if (name in mapList) loadMap(mapList[name]);
  };

  const save = async () => {
    const res = await upsertMap(map);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`Map ${map.name} saved.`);
    refresh();
  };

  const remove = async (name: string) => {
    const res = await deleteMap(name);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`Map ${name} deleted.`);
    refresh();
    newMap();
  };

  return { view, maps, open, create: newMap, save, remove, ...mapEditing(update) } as const;
}

// One of the campaign's own maps, changed with the same editor; a change
// that would strand a party is refused. Null for a map the campaign lacks.
export function useCampaignMapEditor(mapId: string): MapEditing | null {
  const map = useCampaignStore((s) => s.maps[mapId]);
  const parties = useCampaignStore((s) => s.parties);
  const updateCampaign = useCampaignStore((s) => s.updateCampaignState);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the view is read off the store whenever the map or the parties on it change
  const view = useMemo(() => getCampaignMapEditorView(useCampaignStore.getState(), mapId), [map, parties, mapId]);
  return view ? { view, ...mapEditing((change) => updateCampaign(updateCampaignMap(mapId, change))) } : null;
}

// The map the editor's parts work on, and what they do to it, wherever it is kept.
export type MapEditing = { view: MapEditorView } & ReturnType<typeof mapEditing>;
export const MapEditingContext = createContext<MapEditing | null>(null);

export function useMapEditing(): MapEditing {
  const editing = useContext(MapEditingContext);
  if (!editing) throw new Error("useMapEditing must be used inside a MapEditingContext");
  return editing;
}

function mapEditing(update: (change: MapUpdater) => void) {
  const newId = () => crypto.randomUUID();
  return {
    setName: (name: string) => update(setMapName(name)),
    addNode: () => update(addNode(newId)),
    setNode: (id: string, patch: Partial<Pick<CrawlNode, 'name' | 'terrain'>>) => update(setNode(id, patch)),
    toggleSettlement: (id: string) => update(toggleSettlement(id)),
    setSettlementLiving: (id: string, living: number) => update(setSettlementLiving(id, living)),
    customizeNode: (id: string, patch: Partial<TerrainValues>) => update(customizeNode(id, patch)),
    customizeWear: (id: string, patch: Partial<TerrainWear>) => update(customizeNodeWear(id, patch)),
    toggleTag: (id: string, tag: TerrainTag) => update(toggleNodeTag(id, tag)),
    resetValue: (id: string, key: keyof TerrainValues) => update(resetNodeValue(id, key)),
    removeNode: (id: string) => update(removeNode(id)),
    addConnection: (a: string, b: string, DL: number, backDL: number) => update(addConnection(a, b, DL, backDL, newId)),
    setConnection: (id: string, patch: Partial<Pick<Connection, 'DL' | 'backDL'>>) => update(setConnection(id, patch)),
    setWay: (connectionId: string, eventId: string, way: Way) => update(setEventWay(connectionId, eventId, way)),
    removeConnection: (id: string) => update(removeConnection(id)),
    addEvent: (owner: EventOwner) => update(addEvent(owner, newId)),
    setEvent: (owner: EventOwner, eventId: string, patch: Partial<CrawlEvent>) => update(setEvent(owner, eventId, patch)),
    toggleType: (owner: EventOwner, eventId: string, type: EventType) => update(toggleEventType(owner, eventId, type)),
    setEnabler: (owner: EventOwner, eventId: string, knowledge: string, level: number) => update(setEnabler(owner, eventId, knowledge, level)),
    removeEvent: (owner: EventOwner, eventId: string) => update(removeEvent(owner, eventId)),
  } as const;
}
