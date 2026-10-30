import { useMemo } from "react";
import { toast } from "sonner";
import { deleteBoardMap, deleteStructure, saveBoardMap, saveStructure, type ActionResult } from "../actions";
import type { TerrainBrush } from "../domain/types";
import type { BoardExtent, BoardMap, Coord, GroundRecipe, LightLevel } from "../domain/scene/types";
import type { BoardView } from "../domain/scene/projections/boardView";
import { getBoardMap, getBoardMapView, getPieceRows, getStoreyRows } from "../domain/scene/projections/boardMap";
import { getPieceAt, getPieceStructure } from "../domain/scene/rules/board/piece";
import { coordKey } from "../domain/scene/rules/board/geometry";
import { mapOfStructure, newStructureMap, structureOfMap } from "../domain/scene/factories";
import { addLevelBoardMap, generateGroundBoardMap, laySurfaceBoardMap, movePieceBoardMap, placePieceBoardMap, removeLevelBoardMap, removePieceBoardMap, setLevelBoardMap, turnPieceBoardMap, lightBoardMap, surfaceBoardMap, newBoardMap, paintBoardMap, renameBoardMap, resizeBoardMap, type BoardMapUpdater } from "../domain/scene/commands/boardMapEdit";
import { useBoardMapDraftStore, useStructureDraftStore } from "../stores/useBoardMapDraftStore";
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
export function useBoardMapEditor(storeyAt: number, chosen: string | null) {
  const { rows, boardMaps, devServer, refresh, remove } = useBoardMapList();
  return useKeptBoardEditor(useBoardMapDraftStore, storeyAt, chosen, {
    rows, devServer, refresh, remove,
    noun: "Battle map",
    stored: (id) => boardMaps[id] && { map: boardMaps[id].map, shared: boardMaps[id].owner === null },
    keep: saveBoardMap,
    drop: deleteBoardMap,
    fresh: () => newBoardMap(),
  });
}

// The Structures tab: a house or a tree made the way a battle map is, on a
// small board around its anchor, and kept as a structure.
export function useStructureEditor(storeyAt: number) {
  const structures = useAppStore((s) => s.structures);
  const refresh = useAppStore((s) => s.updateStructures);
  const devServer = useAppStore((s) => s.devServer);
  const rows: BoardMapRow[] = useMemo(
    () => Object.values(structures).map((b) => ({ id: b.id, name: b.structure.name, shared: b.owner === null })).sort((a, b) => a.name.localeCompare(b.name)),
    [structures],
  );
  const remove = async (id: string) => {
    const res = await deleteStructure(id);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success("Structure deleted.");
    refresh();
  };
  return useKeptBoardEditor(useStructureDraftStore, storeyAt, null, {
    rows, devServer, refresh, remove,
    noun: "Structure",
    stored: (id) => structures[id] && { map: mapOfStructure(structures[id].structure), shared: structures[id].owner === null },
    keep: (map, shared) => saveStructure(structureOfMap(map), shared),
    drop: deleteStructure,
    fresh: newStructureMap,
  });
}

type KeptBoards = {
  rows: BoardMapRow[];
  devServer: boolean;
  refresh: () => void;
  remove: (id: string) => Promise<void>;
  noun: string;
  stored: (id: string) => { map: BoardMap; shared: boolean } | undefined;
  keep: (map: BoardMap, shared: boolean) => Promise<ActionResult>;
  drop: (id: string) => Promise<ActionResult>;
  fresh: () => BoardMap;
};

// `storeyAt` is the place of the storey painted on among the storeys of the
// map's own, or of the piece `chosen`, the ground first.
function useKeptBoardEditor(useDraft: typeof useBoardMapDraftStore, storeyAt: number, chosen: string | null, kept: KeptBoards) {
  const openId = useDraft((s) => s.openId);
  const map = useDraft((s) => s.map);
  const open = useDraft((s) => s.open);
  const update = useDraft((s) => s.updateMap);
  const structureList = useAppStore((s) => s.structures);
  const refreshStructures = useAppStore((s) => s.updateStructures);
  const piece = chosen !== null && map.pieces[chosen] ? chosen : null;
  const storeys = useMemo(() => getStoreyRows(map, piece), [map, piece]);
  const storey = storeys[storeyAt] ?? storeys[0];
  const level = storey.level;
  const view: BoardView = useMemo(() => getBoardMapView(map, level, piece), [map, level, piece]);
  const pieces = useMemo(() => getPieceRows(map), [map]);
  const structures: BoardMapRow[] = useMemo(
    () => Object.values(structureList).map((b) => ({ id: b.id, name: b.structure.name, shared: b.owner === null })).sort((a, b) => a.name.localeCompare(b.name)),
    [structureList],
  );

  const edit = (updater: BoardMapUpdater) => update(updater);

  const save = async (shared: boolean) => {
    const res = await kept.keep(map, shared);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`${kept.noun} ${map.name} saved.`);
    const before = openId ? kept.stored(openId) : undefined;
    if (openId && before && before.map.name !== map.name && before.shared === shared) await kept.drop(openId);
    kept.refresh();
  };

  return {
    rows: kept.rows, devServer: kept.devServer, view, map, openId, storeys, storey, pieces, piece, structures, save,
    open: (id: string) => { const stored = kept.stored(id); if (stored) open(id, stored.map); },
    create: () => open(null, kept.fresh()),
    remove: async (id: string) => { await kept.remove(id); if (id === openId) open(null, kept.fresh()); },
    setName: (name: string) => edit(renameBoardMap(name)),
    paint: (cell: Coord, brush: TerrainBrush, radius: number) => edit(paintBoardMap(cell, brush, radius, level, piece)),
    light: (level: LightLevel) => edit(lightBoardMap(level)),
    surface: (name: string | null) => edit(surfaceBoardMap(name)),
    laySurface: (cell: Coord, name: string, frozen: string | null, radius: number) => edit(laySurfaceBoardMap(cell, name, Math.floor(Math.random() * 0x7fffffff), frozen, radius, level, piece)),
    generateGround: (recipe: GroundRecipe, seed: number) => edit(generateGroundBoardMap(recipe, seed)),
    resize: (extent: BoardExtent) => edit(resizeBoardMap(extent)),
    addStorey: () => edit(addLevelBoardMap(piece)),
    removeStorey: (at: number) => edit(removeLevelBoardMap(at, piece)),
    setStorey: (at: number, change: { floor?: number, height?: number }) => edit(setLevelBoardMap(at, change, piece)),
    // the piece on the cell, if any
    pieceAt: (cell: Coord) => getPieceAt(map, coordKey(cell)),
    placePiece: (structureId: string, cell: Coord, rotation: number) => {
      const structure = structureList[structureId]?.structure;
      if (structure) edit(placePieceBoardMap(crypto.randomUUID(), structure, cell, rotation));
    },
    movePiece: (id: string, cell: Coord) => edit(movePieceBoardMap(id, cell)),
    turnPiece: (id: string, steps: number) => edit(turnPieceBoardMap(id, steps)),
    removePiece: (id: string) => edit(removePieceBoardMap(id)),
    // keeps the piece as it now stands as a structure of the profile's own
    savePiece: async (id: string) => {
      const structure = getPieceStructure(map, id);
      if (!structure) return;
      const res = await saveStructure(structure, false);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`Structure ${structure.name} saved.`);
      refreshStructures();
    },
  } as const;
}
