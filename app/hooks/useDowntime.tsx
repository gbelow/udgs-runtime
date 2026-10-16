import { useMemo } from "react";
import type { LivingLevel } from "../domain/lists";
import type { Activity, DowntimeUpdater, TrainingTarget } from "../domain/downtime/types";
import { DECISIONS } from "../domain/downtime/types";
import { getDowntimeResultLines, getDowntimePanel, getSkillOptions, getTrainingOptions, type DowntimePanel, type SkillOption, type TrainingOption } from "../domain/downtime/projections/downtime";
import { chooseActivity, chooseTraining, decideTraining, dropBlock, setBlock, setHoused, setLearningGain, setLiving } from "../domain/downtime/commands/plans";
import { answerDowntime, cancelDowntimeCall, passDays, toExploration } from "../domain/downtime/commands/downtime";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useAppStore } from "../stores/useAppStore";
import { getCallRows, getDiceBar, type CallRow } from "../domain/play/calls";
import { getRosterName } from "../domain/campaign/rules/roster";
import { useDieAnswer, useDieCancel, useThrower } from "./useDieCalls";
import { getBlockActor, getToExplorationBar } from "../domain/downtime/rules/downtime";
import type { Actor } from "../domain/profiles";
import { useActGate } from "./useControl";

// story.tex "Downtime" — everyone's plans for the days typed (null: as long
// as the longest plan), gated on a digest so that a change to the campaign
// that leaves the panel as it was draws nothing again.
export function useDowntime(): DowntimePanel {
  const span = useAppStore((s) => s.downtimeSpan);
  const digest = useCampaignStore((s) => JSON.stringify(getDowntimePanel({ campaign: s, downtime: s.downtime }, span)));
  return useMemo(() => JSON.parse(digest), [digest]);
}

// Why the party cannot leave downtime to explore again.
export function useToExplorationBar(partyId: string): string | null {
  return useCampaignStore((s) => getToExplorationBar({ campaign: s, downtime: s.downtime }, partyId));
}

// The days typed for the coming stretch.
export function useDowntimeSpan() {
  const span = useAppStore((s) => s.downtimeSpan);
  const setSpan = useAppStore((s) => s.setDowntimeSpan);
  return { span, setSpan } as const;
}

// What the last days came to.
export function useDowntimeResults(): string[] {
  const results = useCampaignStore((s) => s.downtime.results);
  return useMemo(() => getDowntimeResultLines(results), [results]);
}

// What the character can train.
export function useTrainingOptions(id: string): TrainingOption[] {
  const c = useCampaignStore((s) => s.characters[id]);
  return c ? getTrainingOptions(c) : [];
}

// What the character's activity can be tested with.
export function useSkillOptions(id: string): SkillOption[] {
  const c = useCampaignStore((s) => s.characters[id]);
  return c ? getSkillOptions(c) : [];
}

// Why no plan may change: the passing days wait on dice.
export function useDowntimeDiceBar(): string | null {
  return useCampaignStore((s) => getDiceBar(s.downtime.calls));
}

// The tests the passing days have called for, gated on the calls themselves.
export function useDowntimeCalls(): CallRow[] {
  useCampaignStore((s) => s.downtime.calls);
  const s = useCampaignStore.getState();
  return getCallRows(s.downtime.calls, (id) => getRosterName(s, id), () => true);
}

// The GM's taking back of the activity a die the days called for answers.
export function useDowntimeCancel() {
  const updateDowntime = useCampaignStore((s) => s.updateDowntime);
  return useDieCancel((callId, thrower) => updateDowntime(cancelDowntimeCall(callId, thrower)));
}

// The answer to a test the days call for.
export function useDowntimeAnswer() {
  const updateDowntime = useCampaignStore((s) => s.updateDowntime);
  return useDieAnswer(
    () => useCampaignStore.getState().downtime.calls,
    (callId, die, entered, thrower) => updateDowntime(answerDowntime(callId, die, entered, thrower)),
  );
}

export function useDowntimeCommands() {
  const updateDowntime = useCampaignStore((s) => s.updateDowntime);
  const pick = useCampaignStore((s) => s.setActiveCharacter);
  const gate = useActGate();
  const thrower = useThrower();
  const run = (actor: Actor, updater: DowntimeUpdater) => { if (gate(actor)) updateDowntime(updater); };
  return {
    pick,
    setLiving: (id: string, living: LivingLevel) => run({ id }, setLiving(id, living)),
    setHoused: (id: string, housed: boolean) => run({ id }, setHoused(id, housed)),
    chooseTraining: (id: string, target: TrainingTarget, withTrainer: boolean) => run({ id }, chooseTraining(id, target, withTrainer)),
    chooseActivity: (id: string, activity: Exclude<Activity, 'training'>) => run({ id }, chooseActivity(id, activity)),
    setBlock: (id: string, patch: Record<string, unknown>) => run(getBlockActor(id, patch), setBlock(id, patch)),
    setLearningGain: (id: string, degree: number, gain: number) => run(getBlockActor(id, { gains: gain }), setLearningGain(id, degree, gain)),
    decide: (id: string, decision: (typeof DECISIONS)[number]) => run(getBlockActor(id, { decision }), decideTraining(id, decision)),
    drop: (id: string) => run({ id }, dropBlock(id)),
    passDays: (days: number) => run("gm", passDays(days, thrower)),
    toExploration: (partyId: string) => run("gm", toExploration(partyId)),
  };
}
