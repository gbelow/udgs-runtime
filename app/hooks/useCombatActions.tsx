import { useThrower } from "./useDieCalls";
import { ActionPanelView, getActionPanel, getActionPanelDigest } from "../domain/scene/projections/actionPanel";
import {
  acceptAnswered,
  amendAction,
  amendReaction,
  boostPush as boostPushCommand,
  cancelAction,
  chooseSpell,
  commitAction,
  declareAction,
  declareReaction,
  passReaction,
  payAnswered,
  resolveAction,
  rollAnswered,
  setTarget,
  stepExtend,
  withdrawLastReaction,
  withdrawSpawnedAction,
} from "../domain/scene/commands/action";
import {
  chooseGrapple,
  chooseManeuver,
  improveSpell,
  refundImprovement,
  refundHOP,
  saveGraze,
  spendHOP,
  moveWhileResting,
} from "../domain/scene/commands/choices";
import type { ActionDraft, HOPPurchase } from "../domain/scene/types";
import type { SpellModification } from "../domain/tables";
import { getPanelActor, type PanelPress } from "../domain/scene/rules/decider";
import type { Updater } from "../domain/scene/types";
import { useCombatStore } from "../stores/useCombatStore";
import { useActForGate } from "./useControl";

// The action being played out, and the clicks that move it along. The view
// is gated on a digest of itself, as the roster is; every write is a combat
// command dispatched blindly — the commands refuse what the phase does not
// allow, so the hook does no checking of its own but whether the screen
// plays whom the press acts for (`getPanelActor`, or the reactor named). The
// dice are handed in here, the one place entropy enters; the test decides
// how they are thrown.
export function useCombatActions() {
  useCombatStore(getActionPanelDigest);
  const view: ActionPanelView = getActionPanel(useCombatStore.getState());
  const updateState = useCombatStore((s) => s.updateCombatState);
  const gate = useActForGate();
  const newId = () => crypto.randomUUID();
  const as = (press: PanelPress) => (command: Updater) => { if (gate(getPanelActor(useCombatStore.getState(), press))) updateState(command); };
  const update = as("open");
  const thrower = useThrower();
  const asReactor = (reactorId: string, command: Updater) => { if (gate(reactorId)) updateState(command); };

  const declare = (draft: ActionDraft) => {
    const actorId = useCombatStore.getState().activeCharacterId;
    if (actorId) as("declare")(declareAction(actorId, draft, newId));
  };
  const amend = (fields: Partial<ActionDraft>) => update(amendAction(fields));
  const target = (id: string) => update(setTarget(id));
  const react = (reactorId: string, draft: ActionDraft) => asReactor(reactorId, declareReaction(reactorId, draft, newId));
  const amendReacted = (reactorId: string, fields: Partial<ActionDraft>) => asReactor(reactorId, amendReaction(reactorId, fields));
  const pass = (reactorId: string) => asReactor(reactorId, passReaction(reactorId));
  const cancel = () => update(cancelAction());
  const roll = () => update(rollAnswered(thrower, newId));
  const commit = () => update(commitAction(thrower, newId));
  const back = () => as("back")(withdrawLastReaction());
  const skip = () => update(withdrawSpawnedAction(thrower, newId));
  const pay = () => update(payAnswered(newId, thrower));
  const accept = () => as("accept")(acceptAnswered(newId, thrower));
  const spend = (purchase: HOPPurchase) => update(spendHOP(purchase));
  const refund = (purchase: HOPPurchase) => update(refundHOP(purchase));
  const grapple = (on: boolean) => update(chooseGrapple(on));
  const resolve = () => update(resolveAction(newId, thrower));
  const improve = (name: SpellModification) => update(improveSpell(name));
  const unimprove = (name: SpellModification) => update(refundImprovement(name));
  const grazeSave = () => update(saveGraze());
  const restMove = () => update(moveWhileResting(newId));
  const extend = (delta: 1 | -1) => update(stepExtend(delta));
  const cast = (key: string, quicken: boolean) => update(chooseSpell(key, quicken));
  const choose = (fields: { along?: boolean; item?: string }) => update(chooseManeuver(fields));
  const boostPush = (boost: boolean) => update(boostPushCommand(boost));

  return { view, declare, amend, target, react, amendReacted, pass, cancel, commit, back, skip, roll, pay, accept, spend, refund, grapple, resolve, improve, unimprove, grazeSave, restMove, extend, cast, choose, boostPush } as const;
}
