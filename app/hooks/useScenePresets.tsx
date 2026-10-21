import { useMemo } from "react";
import { getScenePresets } from "../domain/campaign/rules/scenes";
import { getBaseCharacters } from "../domain/character/grouping";
import { useAppStore } from "../stores/useAppStore";
import { useBoardMapList } from "./useBoardMaps";

// The scenes prepared in the catalog, for an event to lead to.
export function useScenePresets() {
  return useMemo(() => getScenePresets(), []);
}

// The shared battle maps a prepared scene may be played on, by name.
export function useSharedBoardNames(): string[] {
  const { rows } = useBoardMapList();
  return useMemo(() => rows.filter((r) => r.shared).map((r) => r.name), [rows]);
}

// The catalog characters a prepared scene may be played against, by name.
export function useCatalogCharacterNames(): string[] {
  const list = useAppStore((s) => s.baseCharacterList);
  return useMemo(() => getBaseCharacters(list).map((c) => c.name), [list]);
}
