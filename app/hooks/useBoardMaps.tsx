import { useMemo } from "react";
import { toast } from "sonner";
import { deleteBoardMap, saveBoardMap } from "../actions";
import type { TerrainBrush } from "../domain/types";
import type { BoardExtent, Coord, GroundRecipe, LightLevel } from "../domain/scene/types";
import type { BoardView } from "../domain/scene/projections/boardView";
import { getBoardMap, getBoardMapView } from "../domain/scene/projections/boardMap";
import { generateGroundBoardMap, laySurfaceBoardMap, lightBoardMap, surfaceBoardMap, newBoardMap, paintBoardMap, renameBoardMap, resizeBoardMap, type BoardMapUpdater } from "../domain/scene/commands/boardMapEdit";
import { useBoardMapDraftStore } from "../stores/useBoardMapDraftStore";
import { useAppStore } from "../stores/useAppStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useSceneDispatch } from "./useSceneDispatch";

export type BoardMapRow = { id: string; name: string; shared: boolean };

// The battle maps kept: the developer's, shared with everyone, and the
// profile's own, by name.
export function useBoardMapList() {
  const boardMaps = useAppStore((s) => s.boardMaps);
  const refresh = useAppStore((s) => s.updateBoardMaps);
  const devServer = useAppStore((s) => s.devServer);
  const rows: BoardMapRow[] = useMemo(
    () => Object.values(boardMaps).map((b) => ({ id: b.id, name: b.map.name, shared: b.owner === null })).sort((a, b) => a.name.localeCompare(b.name)),
    [boardMaps],
  );

  const remove = async (id: string) => {
    const res = await deleteBoardMap(id);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success("Battle map deleted.");
    refresh();
  };

  return { rows, boardMaps, devServer, refresh, remove } as const;
}

// The fight's board kept under a name, and a kept board played on: whoever
// stood on the board comes off it.
export function useBoardMaps() {
  const { rows, boardMaps, devServer, refresh } = useBoardMapList();
  const dispatch = useSceneDispatch();

  const save = async (name: string, shared: boolean) => {
    const map = getBoardMap(useCombatStore.getState(), name);
    if (!map) return;
    const res = await saveBoardMap(map, shared);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`Battle map ${name} saved.`);
    refresh();
  };

  const load = (id: string) => {
    if (id in boardMaps) dispatch({ kind: "loadBoardMap", args: [boardMaps[id].map] });
  };

  return { rows, devServer, save, load } as const;
}

// The Battle maps tab: a kept map opened or begun anew, painted with the
// fight's own brushes, and kept again under its name, as the profile's own or
// (dev server) for everyone. Keeping an opened map under another name moves
// it to that name.
export function useBoardMapEditor() {
  const { rows, boardMaps, devServer, refresh, remove: removeKept } = useBoardMapList();
  const openId = useBoardMapDraftStore((s) => s.openId);
  const map = useBoardMapDraftStore((s) => s.map);
  const open = useBoardMapDraftStore((s) => s.open);
  const update = useBoardMapDraftStore((s) => s.updateMap);
  const view: BoardView = useMemo(() => getBoardMapView(map), [map]);

  const edit = (updater: BoardMapUpdater) => update(updater);

  const save = async (shared: boolean) => {
    const res = await saveBoardMap(map, shared);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`Battle map ${map.name} saved.`);
    const before = openId ? boardMaps[openId] : undefined;
    if (openId && before && before.map.name !== map.name && (before.owner === null) === shared) await deleteBoardMap(openId);
    refresh();
  };

  return {
    rows, view, map, openId, devServer, save,
    open: (id: string) => { if (id in boardMaps) open(id, boardMaps[id].map); },
    create: () => open(null, newBoardMap()),
    remove: async (id: string) => { await removeKept(id); if (id === openId) open(null, newBoardMap()); },
    setName: (name: string) => edit(renameBoardMap(name)),
    paint: (cell: Coord, brush: TerrainBrush) => edit(paintBoardMap(cell, brush)),
    light: (level: LightLevel) => edit(lightBoardMap(level)),
    surface: (name: string | null) => edit(surfaceBoardMap(name)),
    laySurface: (cell: Coord, name: string, frozen: string | null) => edit(laySurfaceBoardMap(cell, name, Math.floor(Math.random() * 0x7fffffff), frozen)),
    generateGround: (recipe: GroundRecipe, seed: number) => edit(generateGroundBoardMap(recipe, seed)),
    resize: (extent: BoardExtent) => edit(resizeBoardMap(extent)),
  } as const;
}
