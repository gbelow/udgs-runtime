import { addAffliction } from "../domain/character/commands";
import { AfflictionRow, AfflictionSection, getAfflictionBoard, getAfflictionRows } from "../domain/character/lenses/afflictions";
import { AfflictionKey } from "../domain/types";
import { getSituationalAfflictions } from "../domain/combat/rules/situational";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

// The whole affliction board: every key the UI can offer, with whether a
// click can change it and whether it is currently on.
export function useAfflictionRows(): { rows: AfflictionRow[]; setAffliction: (a: AfflictionKey) => void } {
  const update = useActiveCharacterUpdate();

  const rows =
    useActiveCharacterDerived(
      (c, fight) => getAfflictionRows(c, getSituationalAfflictions(fight, c.id)),
      (list) => list.map((r) => (r.active ? '1' : '0') + (r.controlable ? '1' : '0')).join(''),
    ) ?? [];

  const setAffliction = (affliction: AfflictionKey) => {
    update(addAffliction(affliction));
  };

  return { rows, setAffliction };
}

// The board sectioned by category with ladders folded into one entry each.
// Sections are fixed by the table, so only which rung each entry shows,
// whether it is lit and whether it can be clicked need to reach the digest —
// a one-rung ladder keeps the same label on and off.
export function useAfflictionBoard(): { sections: AfflictionSection[]; setAffliction: (a: AfflictionKey) => void } {
  const update = useActiveCharacterUpdate();

  const sections =
    useActiveCharacterDerived(
      (c, fight) => getAfflictionBoard(c, getSituationalAfflictions(fight, c.id)),
      (list) => list.map((s) => s.entries.map((e) => (e.active ? '+' : '-') + (e.controlable ? '' : '!') + e.label).join(',')).join('|'),
    ) ?? [];

  const setAffliction = (affliction: AfflictionKey) => {
    update(addAffliction(affliction));
  };

  return { sections, setAffliction };
}
