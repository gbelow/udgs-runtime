import { toast } from "sonner";
import { addRaceAbility, editRace, removeRaceAbility } from "../domain/character/commands";
import { getNaturalWeaponOptions, getRaceAbilityOptions, getRacePanel, raceBonusLenses, type RaceAbilityRow, type RacePanelView } from "../domain/character/lenses/race";
import { getRaceOf } from "../domain/character/rules/race";
import { makeRace } from "../domain/factories";
import type { Character, RaceBonusKey, RaceDraft } from "../domain/types";
import { deleteRace, upsertRace } from "../actions";
import { useAppStore } from "../stores/useAppStore";
import { useRaceStore } from "../stores/useRaceStore";
import { useMemo } from "react";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

const NATURAL_WEAPONS = getNaturalWeaponOptions();

// The saved races, by name.
export function useRaceNames(): { raceList: Record<string, unknown>; races: string[] } {
  const raceList = useAppStore((s) => s.raceList);
  const races = useMemo(() => Object.keys(raceList).sort(), [raceList]);
  return { raceList, races };
}

// creating.tex "Races": the race tab — the race being made, opened from the
// saved races or begun anew, changed, and saved as a race of its own. Only the
// race tab uses it, so it goes to the race store directly; the creature
// editors it shares with the character tab go through the tab.
export function useRace() {
  const update = useRaceStore((s) => s.updateRace);
  const { raceList, races } = useRaceNames();
  const refreshRaces = useAppStore((s) => s.updateRaceList);
  const loadRace = useRaceStore((s) => s.loadRace);
  const newRace = useRaceStore((s) => s.newRace);

  const race = useRaceStore((s) => s.race);
  const view: RacePanelView = useMemo(() => getRacePanel(race), [race]);

  const open = (name: string) => {
    if (name in raceList) loadRace(raceList[name]);
  };

  const edit = (traits: Partial<RaceDraft>) => update(editRace(traits));

  const addAbility = (key: string) => update(addRaceAbility(key));
  const removeAbility = (key: string) => update(removeRaceAbility(key));

  const save = async () => {
    const saved = getRaceOf(race);
    if (!saved) return;
    const res = await upsertRace(saved);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`Race ${saved.name} saved.`);
    refreshRaces();
  };

  const remove = async (name: string) => {
    const res = await deleteRace(name);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`Race ${name} deleted.`);
    refreshRaces();
    newRace();
  };

  return { view, races, open, create: newRace, edit, addAbility, removeAbility, save, remove } as const;
}

// The character editor's race: the saved race the edited character is
// measured against. Choosing it changes nothing of the character; applying it
// puts it on the character as a preset.
export function useRaceBaseline() {
  const update = useActiveCharacterUpdate();
  const { raceList, races } = useRaceNames();
  const id = useActiveCharacterSelector((c: Character) => c.id) ?? null;
  const race = useAppStore((s) => (id ? s.raceBaselines[id] ?? '' : ''));
  const setRaceBaseline = useAppStore((s) => s.setRaceBaseline);
  const choose = (name: string) => { if (id) setRaceBaseline(id, name || null); };
  const apply = () => { if (race in raceList) update({ kind: 'applyRace', args: [makeRace(raceList[race])] }); };
  return { races, race, choose, apply } as const;
}

// The abilities the race being made could still be given.
export function useRaceAbilityOptions(): RaceAbilityRow[] {
  const race = useRaceStore((s) => s.race);
  return useMemo(() => getRaceAbilityOptions(race), [race]);
}

export function useNaturalWeapons(): string[] {
  return NATURAL_WEAPONS;
}

export function useRaceBonus(key: RaceBonusKey) {
  const lens = raceBonusLenses[key];
  const update = useRaceStore((s) => s.updateRace);
  const value = useRaceStore((s) => lens.get(s.race));
  const setValue = (v: number) => update((c: Character) => lens.set(c, v));
  return [value, setValue] as const;
}
