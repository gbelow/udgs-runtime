import { hasGmTools, isActingAsGm, useAppStore } from "../stores/useAppStore";

// Whether whoever is at the screen has the GM mode switch, and whether it is
// on.
export function useRole() {
  const role = useAppStore((s) => s.role);
  const gm = useAppStore(isActingAsGm);
  const setGmMode = useAppStore((s) => s.setGmMode);
  return { gmTools: hasGmTools(role), gm, setGmMode } as const;
}
