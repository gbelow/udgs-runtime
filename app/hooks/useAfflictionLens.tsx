import { addAffliction } from "../domain/character/commands";
import { AfflictionRow, AfflictionSection, getAfflictionBoard, getAfflictionRows, getAfflictions } from "../domain/character/lenses/afflictions";
import { AfflictionKey, Character } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

export function useAfflictionLens() {
  const update = useActiveCharacterUpdate();

  // getAfflictions depends on the afflictions list, the resource thresholds AND
  // the carried burden (an "over" burden is lame), and returns a fresh array
  // each call, so it cannot gate its own re-render by identity. Gate on a digest
  // of the returned list: a digest of the inputs would have to be extended by
  // hand every time the derivation grows a new one.
  const value: AfflictionKey[] =
    useActiveCharacterDerived(
      (c: Character) => (isCampaignCharacter(c) ? getAfflictions(c) : []),
      (list) => list.join(','),
    ) ?? [];

  const setValue = (affliction: AfflictionKey) => {
    update(addAffliction(affliction));
  };

  return [value, setValue] as const;
}

// The whole affliction board: every key the UI can offer, with whether it is
// hand-settable and whether it is currently on. `controlable` is fixed per
// affliction, so only the active flags need to reach the digest.
export function useAfflictionRows(): { rows: AfflictionRow[]; setAffliction: (a: AfflictionKey) => void } {
  const update = useActiveCharacterUpdate();

  const rows =
    useActiveCharacterDerived(
      (c: Character) => getAfflictionRows(c),
      (list) => list.map((r) => (r.active ? '1' : '0')).join(''),
    ) ?? [];

  const setAffliction = (affliction: AfflictionKey) => {
    update(addAffliction(affliction));
  };

  return { rows, setAffliction };
}

// The board sectioned by category with ladders folded into one entry each.
// Sections are fixed by the table, so only which rung each entry shows, and
// whether it is lit, need to reach the digest — a one-rung ladder keeps the
// same label on and off.
export function useAfflictionBoard(): { sections: AfflictionSection[]; setAffliction: (a: AfflictionKey) => void } {
  const update = useActiveCharacterUpdate();

  const sections =
    useActiveCharacterDerived(
      (c: Character) => getAfflictionBoard(c),
      (list) => list.map((s) => s.entries.map((e) => (e.active ? '+' : '-') + e.label).join(',')).join('|'),
    ) ?? [];

  const setAffliction = (affliction: AfflictionKey) => {
    update(addAffliction(affliction));
  };

  return { sections, setAffliction };
}
