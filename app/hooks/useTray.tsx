import { useTrayStore, type TrayRequest } from "../stores/useTrayStore";

// The throw in the dice tray, if one is, and its landing.
export function useTray(): { request: TrayRequest | null; finish: (id: string) => void } {
  const request = useTrayStore((s) => s.queue[0] ?? null);
  const finish = useTrayStore((s) => s.finish);
  return { request, finish };
}
