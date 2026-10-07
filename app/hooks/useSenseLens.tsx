import { senseLenses } from "../domain/character/lenses";
import { Character, Senses } from "../domain/types";
import { useActiveCharacterSelector, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

export function useSenseNumber(senseName: keyof Senses, field: 'bonus' | 'penalty') {
  const lens = senseLenses[senseName][field];
  const update = useActiveCharacterUpdate();
  const value = useActiveCharacterSelector((c: Character) => lens.get(c)) ?? 0;
  const setValue = (newValue: number) => {
    update((c) => lens.set(c, newValue));
  };
  return [value, setValue] as const;
}

export function useSenseRange(senseName: keyof Senses) {
  const lens = senseLenses[senseName].range;
  const update = useActiveCharacterUpdate();
  const value = useActiveCharacterSelector((c: Character) => lens.get(c)) ?? null;
  const setValue = (newValue: number | null) => {
    update((c) => lens.set(c, newValue));
  };
  return [value, setValue] as const;
}

export function useSenseFlag(senseName: keyof Senses, field: 'hasSense' | 'active' | 'reactive') {
  const lens = senseLenses[senseName][field];
  const update = useActiveCharacterUpdate();
  const value = useActiveCharacterSelector((c: Character) => lens.get(c)) ?? false;
  const setValue = (newValue: boolean) => {
    update((c) => lens.set(c, newValue));
  };
  return [value, setValue] as const;
}
