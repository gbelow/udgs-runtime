import { create } from 'zustand'
import type { ClickMenu } from '../domain/scene/commands/clickMenu'

// The menu a click on the board has opened, until it is pressed or dismissed.
type ClickMenuStore = {
  menu: ClickMenu | null
  setMenu: (menu: ClickMenu | null) => void
}

export const useClickMenuStore = create<ClickMenuStore>((set) => ({
  menu: null,
  setMenu: (menu) => set({ menu }),
}))
