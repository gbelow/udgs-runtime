import { create } from 'zustand'
import type { ClickMenu } from '../domain/scene/commands/clickMenu'
import type { ChoicePart } from '../domain/scene/projections/choices'

// The open action an entry of the menu declared, walked a step at a time
// where the menu was (`from`): whose it is, its id once it is seen open, the
// steps the entry gave and the ones walked through since.
export type MenuWalk = { from: ClickMenu, actorId: string, actionId: string | null, given: ChoicePart[], passed: ChoicePart[] }

// The menu a click on the board has opened, until it is pressed or dismissed,
// and the walk an entry of it started, until it is committed, dropped or dismissed.
type ClickMenuStore = {
  menu: ClickMenu | null
  walk: MenuWalk | null
  setMenu: (menu: ClickMenu | null) => void
  startWalk: (walk: MenuWalk) => void
  bindWalk: (actionId: string) => void
  stepWalk: (key: ChoicePart) => void
  backWalk: (key: ChoicePart) => void
  closeWalk: () => void
}

export const useClickMenuStore = create<ClickMenuStore>((set) => ({
  menu: null,
  walk: null,
  setMenu: (menu) => set(menu ? { menu, walk: null } : { menu }),
  startWalk: (walk) => set({ menu: null, walk }),
  bindWalk: (actionId) => set((s) => (s.walk ? { walk: { ...s.walk, actionId } } : {})),
  stepWalk: (key) => set((s) => (s.walk && !s.walk.passed.includes(key) ? { walk: { ...s.walk, passed: [...s.walk.passed, key] } } : {})),
  backWalk: (key) => set((s) => (s.walk ? { walk: { ...s.walk, passed: s.walk.passed.slice(0, Math.max(0, s.walk.passed.lastIndexOf(key))) } } : {})),
  closeWalk: () => set({ walk: null }),
}))
