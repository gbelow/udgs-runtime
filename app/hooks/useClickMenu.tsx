import type { MenuEntry } from "../domain/scene/commands/clickMenu";
import { useClickMenuStore } from "../stores/useClickMenuStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useFollowPick } from "./useFollowPick";
import { useSceneDispatch } from "./useSceneDispatch";

// The menu a click on the board opened, and its presses: an entry is sent as
// the scene's `menu` command, which declares or answers as the panel would;
// picking the clicked character is this screen's alone.
export function useClickMenu() {
  const menu = useClickMenuStore((s) => s.menu);
  const setMenu = useClickMenuStore((s) => s.setMenu);
  const setActiveCharacter = useCombatStore((s) => s.setActiveCharacter);
  const dispatch = useSceneDispatch();
  const { picking, cancel } = useFollowPick();

  const close = () => setMenu(null);
  const press = (entry: MenuEntry) => {
    dispatch({ kind: "menu", args: [entry.press] });
    setMenu(null);
  };
  const select = () => {
    if (menu?.select) setActiveCharacter(menu.select);
    setMenu(null);
  };

  // Escape backs out one thing at a time: the menu, then a follow pick waiting
  // for its click, then whoever is picked.
  const escape = () => {
    if (menu) close();
    else if (picking) cancel();
    else setActiveCharacter(null);
  };

  return { menu, press, select, close, escape } as const;
}
