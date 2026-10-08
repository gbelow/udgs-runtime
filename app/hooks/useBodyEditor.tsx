import { addBodyPart, addPartWound, editBodyPart, editNaturalArmor, editPartWound, editStance, removeBodyPart, removePartWound, setFootprintPreset, toggleFootprintCell, type BodyPartEdit } from "../domain/character/commands";
import { getFootprintEditor } from "../domain/character/lenses/footprint";
import type { FootprintPreset } from "../domain/lists";
import type { Armor, BodyPart, Character, Coord, HitLocation, PartWound, Stance } from "../domain/types";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

type RaceBody = { body: BodyPart[]; stance: Stance; armor: Armor }

const pickBody = (c: Character): RaceBody => ({ body: c.body, stance: c.stance, armor: c.armor });

// The race's side of the creature: its body, stance and natural armor, as the
// editors read it.
export function useBodyView() {
  return useActiveCharacterDerived(pickBody, JSON.stringify);
}

// The footprint as its editor draws it.
export function useFootprintEditor() {
  return useActiveCharacterDerived(getFootprintEditor, JSON.stringify);
}

// The commands that change it. They subscribe to nothing, so a row given its
// part by its parent does not re-render on every edit of the character.
export function useBodyEditor() {
  const update = useActiveCharacterUpdate();

  return {
    addPart: (location: HitLocation) => update(addBodyPart(location)),
    removePart: (id: string) => update(removeBodyPart(id)),
    editPart: (id: string, edit: BodyPartEdit) => update(editBodyPart(id, edit)),
    addWound: (id: string) => update(addPartWound(id)),
    editWound: (id: string, index: number, edit: Partial<PartWound>) => update(editPartWound(id, index, edit)),
    removeWound: (id: string, index: number) => update(removePartWound(id, index)),
    editStance: (edit: Partial<Stance>) => update(editStance(edit)),
    editArmor: (edit: Partial<Armor>) => update(editNaturalArmor(edit)),
    toggleCell: (cell: Coord) => update(toggleFootprintCell(cell)),
    setPreset: (preset: FootprintPreset) => update(setFootprintPreset(preset)),
    placePart: (id: string, cell: Coord | null) => update(editBodyPart(id, { cell })),
  } as const;
}
