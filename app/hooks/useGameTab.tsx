import { useAppStore } from "../stores/useAppStore";

// The only adapter onto the app store's tab. Components read the tab through
// this rather than reaching into the store, so `edit | play | break` stays one
// concept with one owner.
export function useGameTab() {
  const tab = useAppStore((s) => s.selectedGameTab);
  const setTab = useAppStore((s) => s.setSelectedGameTab);

  return { tab, setTab } as const;
}
