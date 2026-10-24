import { ActionPanelView, getActionPanel, getActionPanelDigest } from "../domain/scene/projections/actionPanel";
import type { ActionDraft, HOPPurchase } from "../domain/scene/types";
import type { SpellModification } from "../domain/tables";
import { useCombatStore } from "../stores/useCombatStore";
import { useSceneDispatch } from "./useSceneDispatch";

// The action being played out, and the clicks that move it along. The view
// is gated on a digest of itself, as the roster is; every write is a scene
// command sent blindly — the commands refuse what the phase does not allow,
// and the registry says whom each acts for, so the hook only names the press.
export function useCombatActions() {
  useCombatStore(getActionPanelDigest);
  const view: ActionPanelView = getActionPanel(useCombatStore.getState());
  const dispatch = useSceneDispatch();

  const declare = (draft: ActionDraft) => {
    const actorId = useCombatStore.getState().activeCharacterId;
    if (actorId) dispatch({ kind: "declare", args: [actorId, draft] });
  };
  const amend = (fields: Partial<ActionDraft>) => dispatch({ kind: "amend", args: [fields] });
  const target = (id: string) => dispatch({ kind: "target", args: [id] });
  const react = (reactorId: string, draft: ActionDraft) => dispatch({ kind: "react", args: [reactorId, draft] });
  const amendReacted = (reactorId: string, fields: Partial<ActionDraft>) => dispatch({ kind: "amendReaction", args: [reactorId, fields] });
  const pass = (reactorId: string) => dispatch({ kind: "pass", args: [reactorId] });
  const cancel = () => dispatch({ kind: "cancel", args: [] });
  const roll = () => dispatch({ kind: "roll", args: [] });
  const commit = () => dispatch({ kind: "commit", args: [] });
  const back = () => dispatch({ kind: "back", args: [] });
  const skip = () => dispatch({ kind: "skip", args: [] });
  const pay = () => dispatch({ kind: "pay", args: [] });
  const accept = () => dispatch({ kind: "accept", args: [] });
  const spend = (purchase: HOPPurchase) => dispatch({ kind: "spend", args: [purchase] });
  const refund = (purchase: HOPPurchase) => dispatch({ kind: "refund", args: [purchase] });
  const grapple = (on: boolean) => dispatch({ kind: "grapple", args: [on] });
  const resolve = () => dispatch({ kind: "resolve", args: [] });
  const improve = (name: SpellModification) => dispatch({ kind: "improve", args: [name] });
  const unimprove = (name: SpellModification) => dispatch({ kind: "unimprove", args: [name] });
  const grazeSave = () => dispatch({ kind: "grazeSave", args: [] });
  const restMove = () => dispatch({ kind: "restMove", args: [] });
  const extend = (delta: 1 | -1) => dispatch({ kind: "extend", args: [delta] });
  const cast = (key: string, quicken: boolean) => dispatch({ kind: "cast", args: [key, quicken] });
  const choose = (fields: { along?: boolean; item?: string }) => dispatch({ kind: "choose", args: [fields] });
  const boostPush = (boost: boolean) => dispatch({ kind: "boostPush", args: [boost] });
  const backSegment = () => dispatch({ kind: "backSegment", args: [] });

  return { view, declare, amend, target, react, amendReacted, pass, cancel, commit, back, skip, roll, pay, accept, spend, refund, grapple, resolve, improve, unimprove, grazeSave, restMove, extend, cast, choose, boostPush, backSegment } as const;
}
