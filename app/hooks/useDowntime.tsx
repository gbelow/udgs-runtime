import type { LivingLevel } from "../domain/lists";
import type { Activity, DowntimeUpdater, TrainingTarget } from "../domain/downtime/types";
import { DECISIONS } from "../domain/downtime/types";
import { getDowntimePanel, getSkillOptions, getTrainingOptions, type DowntimePanel, type SkillOption, type TrainingOption } from "../domain/downtime/projections/downtime";
import { chooseActivity, chooseTraining, decideTraining, dropBlock, setBlock, setHoused, setLearningGain, setLiving } from "../domain/downtime/commands/plans";
import { passDays } from "../domain/downtime/commands/downtime";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useAppStore } from "../stores/useAppStore";
import { realDice } from "../components/utils";

// story.tex "Downtime" — everyone's plans for the days typed (null: as long
// as the longest plan). The store and what downtime keeps are replaced on
// every write, so they are the gate and the panel is computed once per pair.
export function useDowntime(): DowntimePanel {
  const span = useAppStore((s) => s.downtimeSpan);
  const campaign = useCampaignStore((s) => s);
  return getDowntimePanel({ campaign, downtime: campaign.downtime }, span);
}

// The days typed for the coming stretch.
export function useDowntimeSpan() {
  const span = useAppStore((s) => s.downtimeSpan);
  const setSpan = useAppStore((s) => s.setDowntimeSpan);
  return { span, setSpan } as const;
}

// What the last days came to.
export function useDowntimeResults() {
  return useCampaignStore((s) => s.downtime.results);
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

export function useDowntimeCommands() {
  const updateDowntime = useCampaignStore((s) => s.updateDowntime);
  const pick = useCampaignStore((s) => s.setActiveCharacter);
  const run = (updater: DowntimeUpdater) => updateDowntime(updater);
  return {
    pick,
    setLiving: (id: string, living: LivingLevel) => run(setLiving(id, living)),
    setHoused: (id: string, housed: boolean) => run(setHoused(id, housed)),
    chooseTraining: (id: string, target: TrainingTarget, withTrainer: boolean) => run(chooseTraining(id, target, withTrainer)),
    chooseActivity: (id: string, activity: Exclude<Activity, 'training'>) => run(chooseActivity(id, activity)),
    setBlock: (id: string, patch: Record<string, unknown>) => run(setBlock(id, patch)),
    setLearningGain: (id: string, degree: number, gain: number) => run(setLearningGain(id, degree, gain)),
    decide: (id: string, decision: (typeof DECISIONS)[number]) => run(decideTraining(id, decision)),
    drop: (id: string) => run(dropBlock(id)),
    passDays: (days: number) => run(passDays(days, realDice)),
  };
}
