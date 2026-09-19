import { rollFull } from "../domain/combat/dice";
import { ActionPanelView, getActionPanel, getActionPanelDigest } from "../domain/combat/lenses/actionPanel";
import {
  amendAction,
  cancelAction,
  declareAction,
  declareReaction,
  resolveAction,
  rollAction,
  setTarget,
  withdrawReaction,
} from "../domain/combat/commands/action";
import { getOpenAction } from "../domain/combat/lenses/action";
import type { ActionDraft } from "../domain/combat/types";
import { useCombatStore } from "../stores/useCombatStore";

// The action being played out, and the clicks that move it along. The view
// is gated on a digest of itself, as the roster is; every write is a combat
// command dispatched blindly — the commands refuse what the phase does not
// allow, so the hook does no checking of its own. The die is thrown here,
// the one place entropy enters, and handed to the command already rolled.
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
  // The reactor is the open action's target, read as of the click.
  const reactorId = () => getOpenAction(useCombatStore.getState())?.targetId ?? null;
  const react = (draft: ActionDraft) => {
    const id = reactorId();
    if (id) update(declareReaction(id, draft, newId));
  };
  const withdraw = () => {
    const id = reactorId();
    if (id) update(withdrawReaction(id));
  };
  const cancel = () => update(cancelAction());
  const roll = () => update(rollAction(rollFull(Math.random)));
  const resolve = () => update(resolveAction());

  return { view, declare, amend, target, react, withdraw, cancel, roll, resolve } as const;
}
