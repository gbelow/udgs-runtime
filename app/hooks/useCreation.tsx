import { useMemo } from "react";
import { buyCreationKnowledge, buyCreationLevel, buyCreationStage, setCreationConviction, setCreationLimitStress, setCreationPriority, setCreationRace } from "../domain/character/commands/creation";
import { getCreationPanel, type CreationPanelView } from "../domain/character/lenses/creation";
import { getCreatedCharacter } from "../domain/character/rules/creation";
import { makeRace } from "../domain/factories";
import type { FamilyKey } from "../domain/abilities";
import type { LimitStressAction } from "../domain/lists";
import type { Focus, Priority, Trainables } from "../domain/types";
import { useCreationStore } from "../stores/useCreationStore";
import { useCharacterStore } from "../stores/useCharacterStore";
import { useGameTab } from "./useGameTab";
import { useRaceNames } from "./useRace";

// creating.tex "Character Creation": the creation tab — the race, the
// priorities and what is bought, until the character fits its budgets and is
// handed to the character tab to be finished and saved.
export function useCreation() {
  const draft = useCreationStore((s) => s.draft);
  const update = useCreationStore((s) => s.updateDraft);
  const newDraft = useCreationStore((s) => s.newDraft);
  const loadCharacter = useCharacterStore((s) => s.loadCharacter);
  const { setTab } = useGameTab();
  const { raceList, races } = useRaceNames();

  const view: CreationPanelView = useMemo(() => getCreationPanel(draft), [draft]);

  const chooseRace = (name: string) => update(setCreationRace(name in raceList ? makeRace(raceList[name]) : null));
  const setPriority = (focus: Focus, priority: Priority) => update(setCreationPriority(focus, priority));
  const chooseLimitStress = (action: LimitStressAction | null) => update(setCreationLimitStress(action));
  const chooseConviction = (slot: 'conviction1' | 'conviction2', name: string) => update(setCreationConviction(slot, name));
  const buyLevel = (key: keyof Trainables, change: 1 | -1) => update(buyCreationLevel(key, change));
  const buyKnowledge = (name: string, change: 1 | -1) => update(buyCreationKnowledge(name, change));
  const buyStage = (family: FamilyKey, change: 1 | -1) => update(buyCreationStage(family, change));

  const finish = () => {
    if (view.problems.length) return;
    loadCharacter(getCreatedCharacter(draft));
    newDraft();
    setTab('edit');
  };

  return { view, races, chooseRace, chooseLimitStress, chooseConviction, setPriority, buyLevel, buyKnowledge, buyStage, finish, restart: newDraft } as const;
}
