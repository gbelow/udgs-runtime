import { useSheetWindowStore } from "../stores/useSheetWindowStore";

// The sheet's window over the scene (stores/useSheetWindowStore.ts).
export function useSheetWindow() {
  return useSheetWindowStore();
}
