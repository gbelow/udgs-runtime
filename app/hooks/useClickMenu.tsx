import { useEffect } from "react";
import type { MenuEntry } from "../domain/scene/commands/clickMenu";
import type { SceneCommand } from "../domain/scene/commands/registry";
import { getGivenSteps, getOpenWalk, getShownReactor, hasOwnToReact, isFinished, walkKey, type AnswerWalk, type OpenWalk, type WalkButton, type WalkKey, type WalkStep } from "../domain/scene/projections/openWalk";
import { useControlled } from "./useControl";
import { useClickMenuStore, type MenuWalk } from "../stores/useClickMenuStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useFollowPick } from "./useFollowPick";
import { useSceneDispatch } from "./useSceneDispatch";

// The menu a click on the board opened, and its presses: an entry is sent as
// the scene's `menu` command, which declares or answers as the panel would,
// and goes on to walk the action it declared or answered, where the menu
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
    const p = entry.press;
    if (menu && p.kind === "declare") startWalk({ from: menu, actorId: p.actorId, actionId: null, given: getGivenSteps(p), passed: {}, pick: null, collapsed: null });
    // the reaction is picked: its walk goes on from what it is made on, theirs shown
    else if (menu?.answering) {
      const id = p.kind === "declare" ? p.actorId : p.reactorId;
      startWalk({ from: menu, actorId: id, actionId: menu.answering, given: [], passed: { [walkKey(menu.answering, id)]: ["answer"] }, pick: { id, review: false }, collapsed: false });
    }
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

const NO_REACTORS: AnswerWalk[] = [];

const walkOf = (state: Parameters<typeof getOpenWalk>[0], walk: MenuWalk | null): OpenWalk | null => (walk ? getOpenWalk(state, walk) : null);

// The action as the walk shows it, gated on a digest of itself, and its
// presses. The walk ends with what it walks: once it is played out or
// dropped, or moves past what the popover plays.
export function useOpenWalk() {
  const walk = useClickMenuStore((s) => s.walk);
  const { bindWalk, stepWalk, backWalk, closeWalk, pickReactor, collapseWalk } = useClickMenuStore.getState();
  useCombatStore((s) => JSON.stringify(walkOf(s, walk)));
  const view = walkOf(useCombatStore.getState(), walk);
  const dispatch = useSceneDispatch();

  const bound = walk?.actionId ?? null;
  const seen = view?.actionId ?? null;
  useEffect(() => {
    if (!walk) return;
    if (bound === null && seen !== null) bindWalk(seen);
    else if (bound !== null && seen === null) closeWalk();
  }, [walk, bound, seen, bindWalk, closeWalk]);

  // a pick is made and gone on from; a toggle or a step is set and stays
  const press = (key: string, step: WalkStep, b: WalkButton) => {
    if (b.command) dispatch(b.command);
    if (step.kind === "pick") stepWalk(key, step.key);
  };
  const next = (key: string, step: WalkStep) => stepWalk(key, step.key);
  const back = (key: string, step: WalkKey) => backWalk(key, step);
  const send = (command: SceneCommand) => dispatch(command);

  // of the reactions, the one reactor shown and whether they are all put away to a button
  const reactors = view?.kind === "exchange" ? view.answerers : NO_REACTORS;
  const controlled = useControlled(reactors.map((a) => a.id));
  const shown = getShownReactor(reactors, controlled, walk?.pick ?? null);
  const expanded = walk?.collapsed === null || walk?.collapsed === undefined ? hasOwnToReact(reactors, controlled) : !walk.collapsed;
  const show = (a: AnswerWalk) => pickReactor({ id: a.id, review: isFinished(a) });

  return { walk, view, press, next, back, send, shown, expanded, show, collapse: collapseWalk } as const;
}
