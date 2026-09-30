import { addAffliction } from "../domain/character/commands";
import { AfflictionRow, AfflictionSection, getAfflictionBoard, getAfflictionRows } from "../domain/character/lenses/afflictions";
import { getAfflictions } from "../domain/character/rules/afflictions";
import { AfflictionKey, Character } from "../domain/types";
import { isCampaignCharacter } from "../domain/utils";
import { getSituationalAfflictions } from "../domain/combat/rules/hazard";
import type { CombatState } from "../domain/combat/types";
import { useActiveCharacterDerived, useActiveCharacterUpdate } from "./useActiveCharacterSelector";

function situational(c: Character, fight: CombatState | null): AfflictionKey[] {
  return fight ? getSituationalAfflictions(fight, c.id) : [];
}

export function useAfflictionLens() {
  const update = useActiveCharacterUpdate();

  // getAfflictions depends on the afflictions list, the resource thresholds AND
  // the carried burden (a container too heavy for the size is lame), and returns a fresh array
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

// The whole affliction board: every key the UI can offer, with whether a
// click can change it and whether it is currently on.
export function useAfflictionRows(): { rows: AfflictionRow[]; setAffliction: (a: AfflictionKey) => void } {
  const update = useActiveCharacterUpdate();

  const rows =
    useActiveCharacterDerived(
      (c, fight) => getAfflictionRows(c, situational(c, fight)),
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
      (c, fight) => getAfflictionBoard(c, situational(c, fight)),
      (list) => list.map((s) => s.entries.map((e) => (e.active ? '+' : '-') + (e.controlable ? '' : '!') + e.label).join(',')).join('|'),
    ) ?? [];

  const setAffliction = (affliction: AfflictionKey) => {
    update(addAffliction(affliction));
  };

  return { sections, setAffliction };
}
