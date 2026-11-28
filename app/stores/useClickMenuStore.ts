import { create } from 'zustand'
import type { ClickMenu } from '../domain/scene/commands/clickMenu'
import type { ReactorPick, WalkKey, WalkState } from '../domain/scene/projections/openWalk'

// The action an entry of the menu declared or reacted to, walked a step at a
// time where the menu was (`from`), the entry pressed under `category`; of
// its reactions, the reactor picked to be shown, and whether they are put
// away to a button (`collapsed`), or as whether the viewer has any to make
// says (null).
export type MenuWalk = WalkState & { from: ClickMenu, category: string | null, pick: ReactorPick | null, collapsed: boolean | null }

// The menu a click on the board has opened, until it is pressed or dismissed,
// the category of it shown (`shown`), and the walk an entry of it started,
// until what it walks is played out, dropped or dismissed; one gone is kept
// (`put`) with where its action stood when it was dismissed (null where it
// was not), to come back once that moves on. A step is walked
// through or gone back to in the list of passed steps its walk keeps
// (`walkKey`).
type ClickMenuStore = {
  menu: ClickMenu | null
  shown: string | null
  walk: MenuWalk | null
  put: { walk: MenuWalk, stage: string | null } | null
  setMenu: (menu: ClickMenu | null, shown?: string | null) => void
  showCategory: (category: string | null) => void
  startWalk: (walk: MenuWalk) => void
  bindWalk: (actionId: string) => void
  stepWalk: (walk: string, key: WalkKey) => void
  backWalk: (walk: string, key: WalkKey) => void
  pickReactor: (pick: ReactorPick) => void
  collapseWalk: (collapsed: boolean) => void
  closeWalk: (stage?: string | null) => void
}

const passedOf = (walk: MenuWalk, key: string) => walk.passed[key] ?? []

export const useClickMenuStore = create<ClickMenuStore>((set) => ({
  menu: null,
  shown: null,
  walk: null,
  put: null,
  // a menu opened over a walk puts it away, to come back once the menu is gone
  setMenu: (menu, shown = null) => set((s) => (menu ? { menu, shown, walk: null, put: s.walk ? { walk: s.walk, stage: null } : s.put } : { menu, shown: null })),
  showCategory: (shown) => set({ shown }),
  startWalk: (walk) => set({ menu: null, shown: null, walk }),
  bindWalk: (actionId) => set((s) => (s.walk ? { walk: { ...s.walk, actionId } } : {})),
  stepWalk: (key, step) => set((s) => (s.walk && !passedOf(s.walk, key).includes(step) ? { walk: { ...s.walk, passed: { ...s.walk.passed, [key]: [...passedOf(s.walk, key), step] } } } : {})),
  backWalk: (key, step) => set((s) => {
    if (!s.walk) return {}
    const passed = passedOf(s.walk, key)
    return { walk: { ...s.walk, passed: { ...s.walk.passed, [key]: passed.slice(0, Math.max(0, passed.lastIndexOf(step))) } } }
  }),
  pickReactor: (pick) => set((s) => (s.walk ? { walk: { ...s.walk, pick, collapsed: false } } : {})),
  collapseWalk: (collapsed) => set((s) => (s.walk ? { walk: { ...s.walk, collapsed } } : {})),
  closeWalk: (stage = null) => set((s) => (s.walk ? { walk: null, put: { walk: s.walk, stage } } : {})),
}))
