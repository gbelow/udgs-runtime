import { hasGmTools, useAppStore } from "../stores/useAppStore";

// Whether the GM tools and the catalog pickers are shown to whoever is at
// the screen.
export function useRole() {
  const role = useAppStore((s) => s.role);
  return { role, gmTools: hasGmTools(role) } as const;
}
