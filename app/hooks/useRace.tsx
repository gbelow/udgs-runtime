import { toast } from "sonner";
import { addRaceAbility, applyRace, commitRace, editRace, removeRaceAbility } from "../domain/character/commands";
import { getNaturalWeaponOptions, getRaceAbilityOptions, getRacePanel, raceBonusLenses, type RaceAbilityRow, type RacePanelView } from "../domain/character/lenses/race";
import { getRaceOf, isMakingRace } from "../domain/character/rules/race";
import { makeRace } from "../domain/factories";
import type { Character, RaceBonusKey, RaceDraft } from "../domain/types";
import { deleteRace, upsertRace } from "../actions";
import { useAppStore } from "../stores/useAppStore";
import { readActiveCharacter, useActiveCharacterDerived, useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

const NO_RACE: RacePanelView = { name: '', description: '', playable: true, abilities: [] };
const NATURAL_WEAPONS = getNaturalWeaponOptions();

// creating.tex "Races": the race being made — picked from the saved races,
// changed, saved as a race of its own, and committed.
export function useRace() {
  const update = useActiveCharacterUpdate();
  const tab = useAppStore((s) => s.selectedGameTab);
  const raceList = useAppStore((s) => s.raceList);
  const refreshRaces = useAppStore((s) => s.updateRaceList);

  const view: RacePanelView = useActiveCharacterDerived(getRacePanel, JSON.stringify) ?? NO_RACE;
  const races = Object.keys(raceList).sort();

  const pick = (name: string) => {
    if (name in raceList) update(applyRace(makeRace(raceList[name])));
  };

  const edit = (traits: Partial<RaceDraft>) => update(editRace(traits));

  const addAbility = (key: string) => update(addRaceAbility(key));
  const removeAbility = (key: string) => update(removeRaceAbility(key));

  const commit = () => update(commitRace);

  const save = async () => {
    const c = readActiveCharacter(tab);
    const race = c ? getRaceOf(c) : null;
    if (!race) return;
    const res = await upsertRace(race);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`Race ${race.name} saved.`);
    refreshRaces();
  };

  const remove = async (name: string) => {
    const res = await deleteRace(name);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`Race ${name} deleted.`);
    refreshRaces();
  };

  return { view, races, pick, edit, addAbility, removeAbility, commit, save, remove } as const;
}

// Whether the active character is still at its race.
export function useIsMakingRace(): boolean {
  return useActiveCharacterSelector(isMakingRace) ?? false;
}

// The abilities the race being made could still be given.
export function useRaceAbilityOptions(): RaceAbilityRow[] {
  return useActiveCharacterDerived(getRaceAbilityOptions, JSON.stringify) ?? [];
}

export function useNaturalWeapons(): string[] {
  return NATURAL_WEAPONS;
}

export function useRaceBonus(key: RaceBonusKey) {
  const lens = raceBonusLenses[key];
  const update = useActiveCharacterUpdate();
  const value = useActiveCharacterSelector((c: Character) => lens.get(c)) ?? 0;
  const setValue = (v: number) => update((c) => lens.set(c, v));
  return [value, setValue] as const;
}
