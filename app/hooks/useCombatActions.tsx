import { realDice } from "../components/utils";
import { ActionPanelView, getActionPanel, getActionPanelDigest } from "../domain/combat/projections/actionPanel";
import {
  amendAction,
  amendReaction,
  cancelAction,
  cancelTriggeringAction,
  aimPush,
  chooseManeuver,
  commitAction,
  declareAction,
  declareReaction,
  improveSpell,
  payAction,
  refundImprovement,
  refundHOP,
  resolveAction,
  rollAction,
  saveGraze,
  setTarget,
  spendHOP,
  withdrawLastReaction,
  withdrawReaction,
  withdrawSpawnedAction,
} from "../domain/combat/commands/action";
import type { ActionDraft, HOPPurchase } from "../domain/combat/types";
import type { SpellModification } from "../domain/tables";
import { useCombatStore } from "../stores/useCombatStore";

// The action being played out, and the clicks that move it along. The view
// is gated on a digest of itself, as the roster is; every write is a combat
// command dispatched blindly — the commands refuse what the phase does not
// allow, so the hook does no checking of its own. The dice are handed in
// here, the one place entropy enters; the test decides how they are thrown.
export function useCombatActions() {
  useCombatStore(getActionPanelDigest);
  const view: ActionPanelView = getActionPanel(useCombatStore.getState());
  const update = useCombatStore((s) => s.updateCombatState);
  const newId = () => crypto.randomUUID();

  const declare = (draft: ActionDraft) => {
    const actorId = useCombatStore.getState().activeCharacterId;
    if (actorId) update(declareAction(actorId, draft, newId));
  };
  const amend = (fields: Partial<ActionDraft>) => update(amendAction(fields));
  const target = (id: string) => update(setTarget(id));
  const react = (reactorId: string, draft: ActionDraft) => update(declareReaction(reactorId, draft, newId));
  const amendReacted = (reactorId: string, fields: Partial<ActionDraft>) => update(amendReaction(reactorId, fields));
  const withdraw = (reactorId: string) => update(withdrawReaction(reactorId));
  const cancel = () => update(cancelAction());
  const cancelTriggering = (actorId: string) => update(cancelTriggeringAction(actorId));
  const roll = () => update(rollAction(realDice, newId));
  const commit = () => update(commitAction());
  const back = () => update(withdrawLastReaction());
  const skip = () => update(withdrawSpawnedAction(newId));
  const pay = () => update(payAction(newId));
  const spend = (purchase: HOPPurchase) => update(spendHOP(purchase));
  const refund = (purchase: HOPPurchase) => update(refundHOP(purchase));
  const resolve = () => update(resolveAction(newId));
  const improve = (name: SpellModification) => update(improveSpell(name));
  const unimprove = (name: SpellModification) => update(refundImprovement(name));
  const grazeSave = () => update(saveGraze());
  const choose = (fields: { along?: boolean; item?: string }) => update(chooseManeuver(fields));
  const aim = (fields: { choice?: 'push' | 'circle' | 'stay'; steps?: number }) => update(aimPush(fields));

  return { view, declare, amend, target, react, amendReacted, withdraw, cancel, cancelTriggering, commit, back, skip, roll, pay, spend, refund, resolve, improve, unimprove, grazeSave, choose, aim } as const;
}
