import { isCatalogTab, isRunTab, RUN_TABS, useAppStore } from "../stores/useAppStore";

// The only adapter onto the app store's tab. Components read the tab through
// this rather than reaching into the store, so the tab stays one concept with
// one owner. `runTab` is the run screen's mode to open it on, `inRun`
// whether the tab is one of them, `runTabs` the modes, and `inCatalog`
// whether the tab is one of the catalog's.
export function useGameTab() {
  const tab = useAppStore((s) => s.selectedGameTab);
  const runTab = useAppStore((s) => s.runTab);
  const setTab = useAppStore((s) => s.setSelectedGameTab);

  return { tab, runTab, inRun: isRunTab(tab), runTabs: RUN_TABS, inCatalog: isCatalogTab(tab), setTab } as const;
}
