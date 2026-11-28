import { useEffect, useMemo, useRef, useState } from "react";
import { useCameraStore, type ScreenSpot } from "../stores/useCameraStore";
import { getAimCells, type BoardView } from "../domain/scene/projections/boardView";
import { getPopoverAim, getPressActor, getResumed, getTurnMenu, type MenuEntry } from "../domain/scene/commands/clickMenu";
import { getStartTurnBar } from "../domain/scene/rules/turn";
import type { SceneCommand } from "../domain/scene/commands/registry";
import { getAimedStep, getGivenSteps, getOpenStage, getOpenWalk, getShownReactor, hasOwnToReact, isFinished, walkKey, type AnswerWalk, type OpenWalk, type WalkButton, type WalkKey, type WalkStep } from "../domain/scene/projections/openWalk";
import { useControlled } from "./useControl";
import { useClickMenuStore, type MenuWalk } from "../stores/useClickMenuStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useFollowPick } from "./useFollowPick";
import { useSceneDispatch } from "./useSceneDispatch";

// The menu a click on the board opened, and its presses: an entry is sent as
// the scene's `menu` command, which declares or answers as the panel would,
// and goes on to walk the action it declared or answered, where the menu
// was; picking the clicked character is this screen's alone. Of its
// categories, the one shown is this screen's too.
// The open action walked again in the popover: the walk put away, where it
// was left, if it still walks it, else a walk from its first step.
export function resumeWalk() {
  const state = useCombatStore.getState();
  const { put, startWalk } = useClickMenuStore.getState();
  if (put && getOpenWalk(state, put.walk)) return startWalk({ ...put.walk, collapsed: false });
  const resumed = getResumed(state);
  if (resumed) startWalk({ from: resumed.from, category: null, actorId: resumed.from.actor, actionId: resumed.actionId, given: [], passed: {}, pick: null, collapsed: false });
}

export function useClickMenu() {
  const menu = useClickMenuStore((s) => s.menu);
  const shown = useClickMenuStore((s) => s.shown);
  const walk = useClickMenuStore((s) => s.walk);
  const put = useClickMenuStore((s) => s.put);
  const { setMenu, showCategory, startWalk } = useClickMenuStore.getState();
  const stage = useCombatStore(getOpenStage);
  // a walk put away is put away where its action stands, and comes back once that moves on
  const closeWalk = () => useClickMenuStore.getState().closeWalk(getOpenStage(useCombatStore.getState()));
  useEffect(() => {
    if (!menu && !walk && put && stage !== null && stage !== put.stage && getOpenWalk(useCombatStore.getState(), put.walk)) resumeWalk();
  }, [menu, walk, put, stage]);
  const setActiveCharacter = useCombatStore((s) => s.setActiveCharacter);
  const dispatch = useSceneDispatch();
  const { picking, cancel } = useFollowPick();

  const close = () => setMenu(null);
  const press = (entry: MenuEntry) => {
    dispatch({ kind: "menu", args: [entry.press] });
    const p = entry.press;
    if (menu && p.kind === "declare") startWalk({ from: menu, category: entry.category, actorId: p.actorId, actionId: null, given: getGivenSteps(p), passed: {}, pick: null, collapsed: null });
    // the reaction is picked: its walk goes on from what it is made on, theirs shown
    else if (menu?.answering) {
      const id = getPressActor(p);
      startWalk({ from: menu, category: entry.category, actorId: id, actionId: menu.answering, given: [], passed: { [walkKey(menu.answering, id)]: ["answer"] }, pick: { id, review: false }, collapsed: null });
    }
    else setMenu(null);
  };
  // with nothing open, the key that goes on brings back the open action's
  // walk, or starts the turn of whoever is picked
  const goOn = (): boolean => {
    const state = useCombatStore.getState();
    if (getOpenStage(state) !== null) {
      resumeWalk();
      return true;
    }
    const id = state.activeCharacterId;
    if (!id || getStartTurnBar(state, id) !== null) return false;
    dispatch({ kind: "startTurn", args: [id] });
    return true;
  };
  // the turn of whoever the menu's actions are for
  const start = () => {
    if (menu) dispatch({ kind: "startTurn", args: [menu.actor] });
    setMenu(null);
  };
  // the turn holder's menu opened with no click, at the category of the tile
  // asked for, aimed at nothing
  const openCategory = (tile: number) => {
    const state = useCombatStore.getState();
    const opened = getTurnMenu(state, state.activeCharacterId);
    if (opened) setMenu(opened, opened.groups[tile]?.category ?? null);
  };
  // Escape backs out one thing at a time: the menu or the walk, then a follow
  // pick waiting for its click, then whoever is picked.
  const escape = () => {
    if (menu) close();
    else if (walk) closeWalk();
    else if (picking) cancel();
    else setActiveCharacter(null);
  };

  return { menu, shown, show: showCategory, walk, press, start, close, closeWalk, escape, openCategory, goOn } as const;
}

// Where on the screen the character the popover is about is drawn, the
// camera snapped to them first; null while it is about nobody, or the board
// does not show them.
export function usePopoverSpot(open: boolean): ScreenSpot | null {
  const menu = useClickMenuStore((s) => s.menu);
  const id = useCombatStore((s) => (open ? getPopoverAim(s, menu) : null));
  const [spot, setSpot] = useState<{ id: string; at: ScreenSpot } | null>(null);
  useEffect(() => {
    if (!id) return;
    const camera = useCameraStore.getState();
    camera.ask(id);
    const frame = requestAnimationFrame(() => {
      const at = useCameraStore.getState().where?.(id) ?? null;
      setSpot(at ? { id, at } : null);
    });
    return () => cancelAnimationFrame(frame);
  }, [id, menu]);
  return id && spot?.id === id ? spot.at : null;
}

// The cells of what the popover was opened on, kept lit while it is open.
export function useMarkedCells(view: BoardView): readonly string[] {
  // a menu opened on the character themself is aimed at nothing
  const at = useClickMenuStore((s) => {
    const from = s.menu ?? s.walk?.from ?? null;
    return from && !(from.at.on === "token" && from.at.id === from.actor) ? from.at : null;
  });
  return useMemo(() => getAimCells(view, at), [view, at]);
}

const NO_REACTORS: AnswerWalk[] = [];

const walkOf = (state: Parameters<typeof getOpenWalk>[0], walk: MenuWalk | null): OpenWalk | null => (walk ? getOpenWalk(state, walk) : null);

// The action as the walk shows it, gated on a digest of itself, and its
// presses. The walk ends with what it walks: once it is played out or
// dropped, or moves past what the popover plays.
export function useOpenWalk() {
  const walk = useClickMenuStore((s) => s.walk);
  const { bindWalk, stepWalk, backWalk, closeWalk, pickReactor, collapseWalk, setMenu } = useClickMenuStore.getState();
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

  // aimed on the board while walked, the target step is gone on from
  const was = useRef<OpenWalk | null>(null);
  useEffect(() => {
    const aimed = getAimedStep(was.current, view);
    was.current = view;
    if (aimed) stepWalk(aimed.walk, aimed.key);
  });

  // a landing's last step gone on from lands it
  const landed = (key: string) => {
    if (view?.kind === "land" && view.walk === key && view.last) dispatch(view.land.command);
  };
  // a pick is made and gone on from; a toggle or a step is set and stays
  const press = (key: string, step: WalkStep, b: WalkButton) => {
    if (b.command) dispatch(b.command);
    if (step.kind !== "pick") return;
    stepWalk(key, step.key);
    landed(key);
  };
  const next = (key: string, step: WalkStep) => {
    stepWalk(key, step.key);
    landed(key);
  };
  const back = (key: string, step: WalkKey) => backWalk(key, step);
  const send = (command: SceneCommand) => dispatch(command);
  // back from the first step of a declaration: the action is cancelled and
  // the menu it was declared from opens again, at the entry's category
  const reopen = (command: SceneCommand) => {
    dispatch(command);
    if (walk) setMenu(walk.from, walk.category);
  };

  // a settled exchange goes on by itself, once, on the screen its action was declared from
  const going = view?.kind === "exchange" && view.settled && walk?.actorId === view.actorId ? view.actionId : null;
  const went = useRef<string | null>(null);
  useEffect(() => {
    if (!going || went.current === going || view?.kind !== "exchange") return;
    went.current = going;
    dispatch(view.go.command);
  });

  // of the reactions, the one reactor shown, and whether they are shown at
  // all: as asked, or while the viewer has a reaction to make or something
  // to say to it (the target's allowing it, an ally's reacting anyway)
  const reactors = view?.kind === "exchange" ? view.answerers : NO_REACTORS;
  const others = view?.kind === "exchange" ? [...(view.accept && view.targetId ? [view.targetId] : []), ...view.heldBack.map((h) => h.id)] : [];
  const controlled = useControlled([...reactors.map((a) => a.id), ...others]);
  const shown = getShownReactor(reactors, controlled, walk?.pick ?? null);
  const toSay = hasOwnToReact(reactors, controlled) || others.some((id) => controlled.includes(id));
  const expanded = walk?.collapsed === null || walk?.collapsed === undefined ? toSay : !walk.collapsed;
  const show = (a: AnswerWalk) => pickReactor({ id: a.id, review: isFinished(a) });

  return { walk, view, press, next, back, send, reopen, shown, controlled, expanded, show, collapse: collapseWalk } as const;
}
