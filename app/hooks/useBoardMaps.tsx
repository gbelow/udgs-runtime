import { useMemo } from "react";
import { toast } from "sonner";
import { deleteBoardMap, saveBoardMap } from "../actions";
import { getBoardMap } from "../domain/scene/projections/boardMap";
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
