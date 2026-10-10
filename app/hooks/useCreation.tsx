import { buyCreationKnowledge, getFinishedCharacter, buyCreationLevel, setCreationProgress, buyCreationStage, setCreationConviction, setCreationLimitStress, setCreationName, setCreationNotes, setCreationPriority, setCreationRace, setCreationSpell, claimCreationSpell } from "../domain/character/commands/creation";
import { getCreationPanel, type CreationPanelView } from "../domain/character/lenses/creation";
import { makeRace } from "../domain/factories";
import type { FamilyKey } from "../domain/abilities";
import type { LimitStressAction } from "../domain/lists";
import type { SpellKey } from "../domain/spells";
import type { CreationDraft, Focus, Priority, SpellMethod, Trainables } from "../domain/types";
import { useCreationStore } from "../stores/useCreationStore";
import { useCharacterStore } from "../stores/useCharacterStore";
import { useGameTab } from "./useGameTab";
import { useRaceNames } from "./useRace";

// Every part of the tab calls the hook, so the view is built once per draft
// and shared rather than once per caller.
const panels = new WeakMap<CreationDraft, CreationPanelView>();
function panelOf(draft: CreationDraft): CreationPanelView {
  const cached = panels.get(draft);
  if (cached) return cached;
  const view = getCreationPanel(draft);
  panels.set(draft, view);
  return view;
}

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

  const view = panelOf(draft);

  const chooseRace = (name: string) => update(setCreationRace(name in raceList ? makeRace(raceList[name]) : null));
  const rename = (name: string) => update(setCreationName(name));
  const annotate = (notes: string) => update(setCreationNotes(notes));
  const setPriority = (focus: Focus, priority: Priority) => update(setCreationPriority(focus, priority));
  const chooseLimitStress = (action: LimitStressAction | null) => update(setCreationLimitStress(action));
  const chooseConviction = (slot: 'conviction1' | 'conviction2', name: string) => update(setCreationConviction(slot, name));
  const buyLevel = (key: keyof Trainables, change: 1 | -1) => update(buyCreationLevel(key, change));
  const setProgress = (key: keyof Trainables, XP: number) => update(setCreationProgress(key, XP));
  const buyKnowledge = (name: string, change: 1 | -1) => update(buyCreationKnowledge(name, change));
  const buyStage = (family: FamilyKey, change: 1 | -1) => update(buyCreationStage(family, change));
  const chooseSpell = (key: SpellKey, method: SpellMethod | null) => update(setCreationSpell(key, method));
  const claimSpell = (key: SpellKey) => update(claimCreationSpell(key));

  const finish = () => {
    if (view.problems.length) return;
    loadCharacter(getFinishedCharacter(draft));
    newDraft();
    setTab('edit');
  };

  return { view, races, rename, annotate, chooseRace, chooseLimitStress, chooseConviction, setPriority, buyLevel, setProgress, buyKnowledge, buyStage, chooseSpell, claimSpell, finish, restart: newDraft } as const;
}
