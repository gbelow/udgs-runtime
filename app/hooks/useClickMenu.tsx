import { useEffect } from "react";
import type { MenuEntry } from "../domain/scene/commands/clickMenu";
import { getGivenSteps, getOpenWalk, type OpenWalk, type WalkButton } from "../domain/scene/projections/openWalk";
import { useClickMenuStore, type MenuWalk } from "../stores/useClickMenuStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useFollowPick } from "./useFollowPick";
import { useSceneDispatch } from "./useSceneDispatch";

// The menu a click on the board opened, and its presses: an entry is sent as
// the scene's `menu` command, which declares or answers as the panel would,
// and one that declares goes on to walk the action it opened, where the menu
// was; picking the clicked character is this screen's alone.
export function useClickMenu() {
  const menu = useClickMenuStore((s) => s.menu);
  const walk = useClickMenuStore((s) => s.walk);
  const setMenu = useClickMenuStore((s) => s.setMenu);
  const startWalk = useClickMenuStore((s) => s.startWalk);
  const closeWalk = useClickMenuStore((s) => s.closeWalk);
  const setActiveCharacter = useCombatStore((s) => s.setActiveCharacter);
  const dispatch = useSceneDispatch();
  const { picking, cancel } = useFollowPick();

  const close = () => setMenu(null);
  const press = (entry: MenuEntry) => {
    dispatch({ kind: "menu", args: [entry.press] });
    if (menu && entry.press.kind === "declare") startWalk({ from: menu, actorId: entry.press.actorId, actionId: null, given: getGivenSteps(entry.press), passed: [] });
    else setMenu(null);
  };
  // the turn of whoever the menu's actions are for
  const start = () => {
    if (menu) dispatch({ kind: "startTurn", args: [menu.actor] });
    setMenu(null);
  };
  // Escape backs out one thing at a time: the menu or the walk, then a follow
  // pick waiting for its click, then whoever is picked.
  const escape = () => {
    if (menu) close();
    else if (walk) closeWalk();
    else if (picking) cancel();
    else setActiveCharacter(null);
  };

  return { menu, walk, press, start, close, closeWalk, escape } as const;
}

const walkOf = (state: Parameters<typeof getOpenWalk>[0], walk: MenuWalk | null): OpenWalk | null =>
  walk ? getOpenWalk(state, walk.actorId, walk.given, walk.passed) : null;

// The open action as the walk shows it, gated on a digest of itself, and its
// presses. The walk ends with the action it walks: once it is committed or
// dropped, or another is open in its place.
export function useOpenWalk() {
  const walk = useClickMenuStore((s) => s.walk);
  const { bindWalk, stepWalk, backWalk, closeWalk } = useClickMenuStore.getState();
  useCombatStore((s) => JSON.stringify(walkOf(s, walk)));
  const view = walkOf(useCombatStore.getState(), walk);
  const dispatch = useSceneDispatch();

  const actionId = walk?.actionId ?? null;
  const openId = view?.actionId ?? null;
  useEffect(() => {
    if (!walk) return;
    if (actionId === null && openId !== null) bindWalk(openId);
    else if (actionId !== null && openId !== actionId) closeWalk();
  }, [walk, actionId, openId, bindWalk, closeWalk]);

  const pick = (b: WalkButton) => {
    if (b.command) dispatch(b.command);
    if (view?.step) stepWalk(view.step.key);
  };
  const toggle = (b: WalkButton) => {
    if (b.command) dispatch(b.command);
  };
  const next = () => {
    if (view?.step) stepWalk(view.step.key);
  };
  const back = () => {
    if (view?.back) backWalk(view.back);
  };
  const commit = () => {
    if (view) dispatch(view.commit.command);
  };
  const drop = () => {
    if (view?.drop) dispatch(view.drop.command);
  };

  return { walk, view, pick, toggle, next, back, commit, drop } as const;
}
