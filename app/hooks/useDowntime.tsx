import { useMemo } from "react";
import type { LivingLevel } from "../domain/lists";
import type { Activity, TrainingTarget } from "../domain/downtime/types";
import { DECISIONS } from "../domain/downtime/types";
import { getDowntimeResultLines, getDowntimePanel, getSkillOptions, getTrainingOptions, type DowntimePanel, type SkillOption, type TrainingOption } from "../domain/downtime/projections/downtime";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useAppStore } from "../stores/useAppStore";
import { getCallRows, getDiceBar, type CallRow } from "../domain/play/calls";
import { getRosterName } from "../domain/campaign/rules/roster";
import { useAutoThrow, useDieAnswer } from "./useDieCalls";
import { useDowntimeDispatch } from "./useSceneDispatch";
import { getToExplorationBar } from "../domain/downtime/rules/downtime";

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
  return getCallRows(s.downtime.calls, (id) => getRosterName(s, id));
}

// The answer to a test the days call for.
export function useDowntimeAnswer() {
  const send = useDowntimeDispatch();
  return useDieAnswer(
    () => useCampaignStore.getState().downtime.calls,
    (callId, die, source) => send({ kind: "answer", args: [callId, die, source] }),
  );
}

// The days' dice that are this screen's own, answered by themselves.
export function useDowntimeAutoThrow() {
  useAutoThrow(useCampaignStore((s) => s.downtime.calls), useDowntimeAnswer());
}

export function useDowntimeCommands() {
  const send = useDowntimeDispatch();
  const pick = useCampaignStore((s) => s.setActiveCharacter);
  return {
    pick,
    setLiving: (id: string, living: LivingLevel) => send({ kind: "setLiving", args: [id, living] }),
    setHoused: (id: string, housed: boolean) => send({ kind: "setHoused", args: [id, housed] }),
    chooseTraining: (id: string, target: TrainingTarget, withTrainer: boolean) => send({ kind: "chooseTraining", args: [id, target, withTrainer] }),
    chooseActivity: (id: string, activity: Exclude<Activity, 'training'>) => send({ kind: "chooseActivity", args: [id, activity] }),
    setBlock: (id: string, patch: Record<string, unknown>) => send({ kind: "setBlock", args: [id, patch] }),
    setLearningGain: (id: string, degree: number, gain: number) => send({ kind: "setLearningGain", args: [id, degree, gain] }),
    decide: (id: string, decision: (typeof DECISIONS)[number]) => send({ kind: "decide", args: [id, decision] }),
    drop: (id: string) => send({ kind: "drop", args: [id] }),
    passDays: (days: number) => send({ kind: "passDays", args: [days] }),
    toExploration: (partyId: string) => send({ kind: "toExploration", args: [partyId] }),
  };
}
