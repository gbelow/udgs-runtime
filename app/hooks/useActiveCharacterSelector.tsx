import { CampaignCharacter, Character } from "../domain/types";
import { useAppStore } from "../stores/useAppStore";
import { useCharacterStore } from "../stores/useCharacterStore";
import { useCombatStore } from "../stores/useCombatStore";

type CharacterUpdater = (c: Character) => Character;
type CampaignUpdater = (c: CampaignCharacter) => CampaignCharacter;

// Read side: select a derived value off the active character *inside* the
// Zustand selector, so the store gates re-renders on the computed output
// (Object.is by default) rather than on the whole-character reference. This is
// what stops a one-field mutation from re-rendering every subscriber: only
// changed outputs trigger a render.
//
// Both stores are subscribed unconditionally (no conditional hook calls), but
// only the one that owns the active tab runs `sel` — the idle store's selector
// short-circuits to a constant null, so it allocates nothing and forces no
// render. `sel` therefore runs exactly once per render, against exactly one
// character, which is what lets a caller pass a useShallow-wrapped selector for
// non-primitive results: a single wrapper holds one memo cache, and only one
// store ever drives it.
export function useActiveCharacterSelector<T>(
  sel: (c: Character) => T,
): T | null {
  const tab = useAppStore((s) => s.selectedGameTab);
  const editVal = useCharacterStore((s) =>
    tab === "edit" ? (s.character ? sel(s.character) : null) : null,
  );
  const combatVal = useCombatStore((s) => {
    if (tab === "edit") return null;
    const id = s.activeCharacterId;
    if (!id) return null;
    const c = s.characters[id];
    return c ? sel(c) : null;
  });
  return tab === "edit" ? editVal : combatVal;
}

// Non-reactive snapshot of the active character — for deriving display-only
// values (e.g. tooltip term breakdowns) WITHOUT subscribing. A caller that
// wants updates must gate its own re-render reactively (via
// useActiveCharacterSelector on the derived value); this read alone does not
// trigger re-renders. Module-level stores expose getState(), so this works on
// the server too.
export function readActiveCharacter(tab: "edit" | "play" | "break"): Character | null {
  if (tab === "edit") return useCharacterStore.getState().character;
  const s = useCombatStore.getState();
  const id = s.activeCharacterId;
  return id ? (s.characters[id] ?? null) : null;
}

// Write side: the unified updater, without subscribing to the whole character.
// Selecting just the stable action refs (and the tab) avoids re-introducing the
// whole-character subscription that useActiveCharacter carries on its read path.
export function useActiveCharacterUpdate() {
  const tab = useAppStore((s) => s.selectedGameTab);
  const updateCharacter = useCharacterStore((s) => s.updateCharacter);
  const updateCombatActive = useCombatStore((s) => s.updateActiveCharacter);

  function update(updater: CharacterUpdater): Character | undefined;
  function update(updater: CampaignUpdater): CampaignCharacter | undefined;
  function update(updater: CharacterUpdater | CampaignUpdater) {
    if (tab === "edit") return updateCharacter(updater as CharacterUpdater);
    return updateCombatActive(updater as CampaignUpdater);
  }
  return update;
}
