import { equipArmor } from "../domain/commands/equipArmor";
import { makeTextLens } from "../domain/selectors/factories";
import { Armor, ArmorSchema, Character, Skills } from "../domain/types";
import { useActiveCharacter } from "./useActiveCharacter";

export function useArmorLens() {
  const { character, update } = useActiveCharacter();

  const value = character?.armor ? character.armor : ArmorSchema.parse({});

  const setValue = (newValue: Armor) => {
    update(equipArmor(newValue));
  };

  return [value, setValue] as const;
}