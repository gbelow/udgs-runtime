import { addBodyPart, addPartWound, editBodyPart, editNaturalArmor, editPartWound, editStance, removeBodyPart, removePartWound, setShape, type BodyPartEdit } from "../domain/character/commands";
import type { Armor, BodyPart, Character, HitLocation, PartWound, Shape, Stance } from "../domain/types";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

type RaceBody = { body: BodyPart[]; stance: Stance; armor: Armor; shape: Shape }

const pickBody = (c: Character): RaceBody => ({ body: c.body, stance: c.stance, armor: c.armor, shape: c.shape });

// The race's side of the creature while the race is being made: its body,
// stance, natural armor and grid shape.
export function useBodyEditor() {
  const update = useActiveCharacterUpdate();
  const view = useActiveCharacterDerived(pickBody, JSON.stringify);

  return {
    view,
    addPart: (location: HitLocation) => update(addBodyPart(location)),
    removePart: (id: string) => update(removeBodyPart(id)),
    editPart: (id: string, edit: BodyPartEdit) => update(editBodyPart(id, edit)),
    addWound: (id: string) => update(addPartWound(id)),
    editWound: (id: string, index: number, edit: Partial<PartWound>) => update(editPartWound(id, index, edit)),
    removeWound: (id: string, index: number) => update(removePartWound(id, index)),
    editStance: (edit: Partial<Stance>) => update(editStance(edit)),
    editArmor: (edit: Partial<Armor>) => update(editNaturalArmor(edit)),
    setShape: (shape: Shape) => update(setShape(shape)),
  } as const;
}
