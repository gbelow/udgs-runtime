import { createContext, useContext, useMemo } from "react";
import { toast } from "sonner";
import type { Connection, CrawlEvent, CrawlNode, EventOwner, EventType, TerrainTag, TerrainValues, TerrainWear, Way } from "../domain/campaign/types";
import { getCampaignMapEditorView, getMapEditorView, type MapEditorView } from "../domain/campaign/projections/map";
import { toMapUpdater, type MapCommand } from "../domain/campaign/commands/mapRegistry";
import { useCampaignDispatch } from "./useSceneDispatch";
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

  return { view, maps, open, create: newMap, save, remove, ...mapEditing((edit) => update(toMapUpdater(edit, { newId: () => crypto.randomUUID() }))) } as const;
}

// One of the campaign's own maps, changed with the same editor; a change
// that would strand a party is refused. Null for a map the campaign lacks.
export function useCampaignMapEditor(mapId: string): MapEditing | null {
  const map = useCampaignStore((s) => s.maps[mapId]);
  const parties = useCampaignStore((s) => s.parties);
  const send = useCampaignDispatch();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the view is read off the store whenever the map or the parties on it change
  const view = useMemo(() => getCampaignMapEditorView(useCampaignStore.getState(), mapId), [map, parties, mapId]);
  return view ? { view, ...mapEditing((edit) => send({ kind: "editMap", args: [mapId, edit] })) } : null;
}

// The map the editor's parts work on, and what they do to it, wherever it is kept.
export type MapEditing = { view: MapEditorView } & ReturnType<typeof mapEditing>;
export const MapEditingContext = createContext<MapEditing | null>(null);

export function useMapEditing(): MapEditing {
  const editing = useContext(MapEditingContext);
  if (!editing) throw new Error("useMapEditing must be used inside a MapEditingContext");
  return editing;
}

function mapEditing(update: (edit: MapCommand) => void) {
  return {
    setName: (name: string) => update({ kind: 'setMapName', args: [name] }),
    addNode: () => update({ kind: 'addNode', args: [] }),
    setNode: (id: string, patch: Partial<Pick<CrawlNode, 'name' | 'terrain'>>) => update({ kind: 'setNode', args: [id, patch] }),
    toggleSettlement: (id: string) => update({ kind: 'toggleSettlement', args: [id] }),
    setSettlementLiving: (id: string, living: number) => update({ kind: 'setSettlementLiving', args: [id, living] }),
    customizeNode: (id: string, patch: Partial<TerrainValues>) => update({ kind: 'customizeNode', args: [id, patch] }),
    customizeWear: (id: string, patch: Partial<TerrainWear>) => update({ kind: 'customizeNodeWear', args: [id, patch] }),
    toggleTag: (id: string, tag: TerrainTag) => update({ kind: 'toggleNodeTag', args: [id, tag] }),
    resetValue: (id: string, key: keyof TerrainValues) => update({ kind: 'resetNodeValue', args: [id, key] }),
    removeNode: (id: string) => update({ kind: 'removeNode', args: [id] }),
    addConnection: (a: string, b: string, DL: number, backDL: number) => update({ kind: 'addConnection', args: [a, b, DL, backDL] }),
    setConnection: (id: string, patch: Partial<Pick<Connection, 'DL' | 'backDL'>>) => update({ kind: 'setConnection', args: [id, patch] }),
    setWay: (connectionId: string, eventId: string, way: Way) => update({ kind: 'setEventWay', args: [connectionId, eventId, way] }),
    removeConnection: (id: string) => update({ kind: 'removeConnection', args: [id] }),
    addEvent: (owner: EventOwner) => update({ kind: 'addEvent', args: [owner] }),
    setEvent: (owner: EventOwner, eventId: string, patch: Partial<CrawlEvent>) => update({ kind: 'setEvent', args: [owner, eventId, patch] }),
    toggleType: (owner: EventOwner, eventId: string, type: EventType) => update({ kind: 'toggleEventType', args: [owner, eventId, type] }),
    setEnabler: (owner: EventOwner, eventId: string, knowledge: string, level: number) => update({ kind: 'setEnabler', args: [owner, eventId, knowledge, level] }),
    removeEvent: (owner: EventOwner, eventId: string) => update({ kind: 'removeEvent', args: [owner, eventId] }),
  } as const;
}
