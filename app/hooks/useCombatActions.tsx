import type { RollMode } from "../domain/play/dice";
import type { SurgeKind } from "../domain/types";
import { ActionPanelView, getActionPanel, getActionPanelDigest } from "../domain/scene/projections/actionPanel";
import type { ActionDraft, HOPPurchase, ReactionAmend, SightingChoice } from "../domain/scene/types";
import type { chooseManeuver } from "../domain/scene/commands/choices";
import type { SpellModification } from "../domain/tables";
import { getActionMenu, getActionMenuDigest, type MenuEntry } from "../domain/scene/commands/clickMenu";
import { useCombatStore } from "../stores/useCombatStore";
import { useSceneDispatch } from "./useSceneDispatch";

// The action being played out, and the clicks that move it along. The view
// is gated on a digest of itself, as the roster is; every write is a scene
// command sent blindly — the commands refuse what the phase does not allow,
// and the registry says whom each acts for, so the hook only names the press.
export function useCombatActions() {
  useCombatStore(getActionPanelDigest);
  useCombatStore(getActionMenuDigest);
  const state = useCombatStore.getState();
  const view: ActionPanelView = getActionPanel(state);
  // what the active character may declare, as the board's menu offers it
  const menu = getActionMenu(state, state.activeCharacterId);
  const dispatch = useSceneDispatch();

  const press = (entry: MenuEntry) => dispatch({ kind: "menu", args: [entry.press] });
  const amend = (fields: Partial<ActionDraft>) => dispatch({ kind: "amend", args: [fields] });
  // the character may answer this action against their own party
  const turnOnAllies = (id: string) => dispatch({ kind: "openAgainstAllies", args: [id] });
  const target = (id: string) => dispatch({ kind: "target", args: [id] });
  const react = (reactorId: string, draft: ActionDraft, surge: SurgeKind | null) => dispatch({ kind: "react", args: [reactorId, draft, surge] });
  const amendReacted = (reactorId: string, fields: ReactionAmend) => dispatch({ kind: "amendReaction", args: [reactorId, fields] });
  const pass = (reactorId: string) => dispatch({ kind: "pass", args: [reactorId] });
  const confirmReacted = (reactorId: string) => dispatch({ kind: "confirmReaction", args: [reactorId] });
  const cancel = () => dispatch({ kind: "cancel", args: [] });
  const roll = () => dispatch({ kind: "roll", args: [] });
  const commit = () => dispatch({ kind: "commit", args: [] });
  const back = () => dispatch({ kind: "back", args: [] });
  const skip = () => dispatch({ kind: "skip", args: [] });
  const pay = () => dispatch({ kind: "pay", args: [] });
  const accept = () => dispatch({ kind: "accept", args: [] });
  const spellTestMode = (mode: RollMode) => dispatch({ kind: "spellTestMode", args: [mode] });
  const spend = (purchase: HOPPurchase) => dispatch({ kind: "spend", args: [purchase] });
  const refund = (purchase: HOPPurchase) => dispatch({ kind: "refund", args: [purchase] });
  const grapple = (on: boolean) => dispatch({ kind: "grapple", args: [on] });
  const theft = (take: boolean) => dispatch({ kind: "theft", args: [take] });
  const sight = (choice: SightingChoice) => dispatch({ kind: "sight", args: [choice] });
  const resolve = () => dispatch({ kind: "resolve", args: [] });
  const improve = (name: SpellModification) => dispatch({ kind: "improve", args: [name] });
  const unimprove = (name: SpellModification) => dispatch({ kind: "unimprove", args: [name] });
  const grazeSave = () => dispatch({ kind: "grazeSave", args: [] });
  const restMove = () => dispatch({ kind: "restMove", args: [] });
  const extend = (delta: 1 | -1) => dispatch({ kind: "extend", args: [delta] });
  const cast = (key: string, quicken: boolean) => dispatch({ kind: "cast", args: [key, quicken] });
  const choose = (fields: Parameters<typeof chooseManeuver>[0]) => dispatch({ kind: "choose", args: [fields] });
  const boostPush = (boost: boolean) => dispatch({ kind: "boostPush", args: [boost] });
  const backSegment = () => dispatch({ kind: "backSegment", args: [] });

  return { view, menu, press, amend, turnOnAllies, target, react, amendReacted, confirmReacted, pass, cancel, commit, back, skip, roll, pay, accept, spellTestMode, spend, refund, grapple, theft, sight, resolve, improve, unimprove, grazeSave, restMove, extend, cast, choose, boostPush, backSegment } as const;
}
