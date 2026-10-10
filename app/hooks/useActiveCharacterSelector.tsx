import { CampaignCharacter, Character, CreationDraft } from "../domain/types";
import type { SceneState } from "../domain/scene/types";
import { GameTabs, isFightTab, TAB_OWNER, useAppStore } from "../stores/useAppStore";
import { useCharacterStore } from "../stores/useCharacterStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useRaceStore } from "../stores/useRaceStore";
import { useCreationStore } from "../stores/useCreationStore";
import { updateCreationCharacter } from "../domain/character/commands/creation";
import { getCreatedCharacter } from "../domain/character/rules/creation";
import { useCampaignStore } from "../stores/useCampaignStore";
import { updateInventory } from "../domain/scene/commands/characters";
import { getActiveCharacter } from "../domain/scene/rules/fighters";

type CharacterUpdater = (c: Character) => Character;

// Every gear panel on the creation tab reads the character the draft makes, so
// it is built once per draft rather than once per subscriber.
const created = new WeakMap<CreationDraft, Character>();
function createdOf(draft: CreationDraft): Character {
  let c = created.get(draft);
  if (!c) {
    c = getCreatedCharacter(draft);
    created.set(draft, c);
  }
  return c;
}
type CampaignUpdater = (c: CampaignCharacter) => CampaignCharacter;

// Read side: select a derived value off the active character *inside* the
// Zustand selector, so the store gates re-renders on the computed output
// (Object.is by default) rather than on the whole-character reference. This is
// what stops a one-field mutation from re-rendering every subscriber: only
// changed outputs trigger a render.
//
// The edit tab's character, the creation tab's draft (read as the character it
// makes), the race tab's race being made, the party's active character and the
// fight's each live in their own store. All five are
// subscribed unconditionally (no conditional hook calls), but only the one
// that owns the active tab (TAB_OWNER) runs `sel` — an idle store's selector short-circuits to a
// constant null, so it allocates nothing and forces no
// render. `sel` therefore runs exactly once per render, against exactly one
// character, which is what lets a caller pass a useShallow-wrapped selector for
// non-primitive results: a single wrapper holds one memo cache, and only one
// store ever drives it. `sel` is handed the fight the character is in too —
// null on the edit, race and party tabs, where there is none.
export function useActiveCharacterSelector<T>(
  sel: (c: Character, fight: SceneState | null) => T,
): T | null {
  const owner = TAB_OWNER[useAppStore((s) => s.selectedGameTab)];
  const vals = {
    character: useCharacterStore((s) => (owner === "character" ? sel(s.character, null) : null)),
    creation: useCreationStore((s) => (owner === "creation" ? sel(createdOf(s.draft), null) : null)),
    race: useRaceStore((s) => (owner === "race" ? sel(s.race, null) : null)),
    campaign: useCampaignStore((s) => {
      const c = owner === "campaign" ? getActiveCharacter(s) : null;
      return c ? sel(c, null) : null;
    }),
    combat: useCombatStore((s) => {
      const c = owner === "combat" ? getActiveCharacter(s) : null;
      return c ? sel(c, s) : null;
    }),
  };
  return owner ? vals[owner] : null;
}

// Non-reactive snapshot of the active character. In an event handler this is
// simply correct — a click wants the state as of the click. On the render path
// it subscribes to nothing, so it is sound only while every input of whatever is
// derived from it is separately subscribed, and that argument has to be
// re-checked by hand each time the derivation grows a dependency. Prefer
// useActiveCharacterSelector (primitives) or useActiveCharacterDerived
// (freshly-allocated shapes), which gate on the derived value itself.
export function readActiveCharacter(tab: GameTabs): Character | null {
  const owner = TAB_OWNER[tab];
  if (owner === "character") return useCharacterStore.getState().character;
  if (owner === "creation") return createdOf(useCreationStore.getState().draft);
  if (owner === "race") return useRaceStore.getState().race;
  if (owner === "campaign") return getActiveCharacter(useCampaignStore.getState());
  if (owner === "combat") return getActiveCharacter(useCombatStore.getState());
  return null;
}

// Write side: the unified updater, without subscribing to the whole character.
// Selecting just the stable action refs (and the tab) avoids re-introducing the
// whole-character subscription that useActiveCharacter carries on its read path.
export function useActiveCharacterUpdate() {
  const updateCombatActive = useCombatStore((s) => s.updateActiveCharacter);
  return useUpdater(updateCombatActive);
}

// The same, for a move with the character's gear: in a fight the combat
// domain refuses what would spend AP outside their own turn.
export function useActiveInventoryUpdate() {
  const updateCombatState = useCombatStore((s) => s.updateCombatState);
  return useUpdater((updater) => {
    const id = useCombatStore.getState().activeCharacterId;
    if (!id) return undefined;
    updateCombatState(updateInventory(id, updater));
    return useCombatStore.getState().characters[id];
  });
}

function useUpdater(updateCombatActive: (updater: CampaignUpdater) => CampaignCharacter | undefined) {
  const tab = useAppStore((s) => s.selectedGameTab);
  const updateCharacter = useCharacterStore((s) => s.updateCharacter);
  const updateRace = useRaceStore((s) => s.updateRace);
  const updateDraft = useCreationStore((s) => s.updateDraft);
  const updatePartyActive = useCampaignStore((s) => s.updateActiveCharacter);

  function update(updater: CharacterUpdater): Character | undefined;
  function update(updater: CampaignUpdater): CampaignCharacter | undefined;
  function update(updater: CharacterUpdater | CampaignUpdater) {
    const owner = TAB_OWNER[tab];
    if (owner === "character") return updateCharacter(updater as CharacterUpdater);
    if (owner === "creation") return createdOf(updateDraft(updateCreationCharacter(updater as CharacterUpdater)));
    if (owner === "race") return updateRace(updater as CharacterUpdater);
    if (owner === "campaign") return updatePartyActive(updater as CampaignUpdater);
    return updateCombatActive(updater as CampaignUpdater);
  }
  return update;
}

// A derived shape that is freshly allocated on every call — a term breakdown, a
// table of rows — cannot gate its own re-render by identity, and a one-level
// useShallow cannot either once its elements are objects. Gate it on a string
// digest of itself: everything the UI can read off the shape is in the digest,
// so any change that alters what is displayed is a change that schedules the
// render which recomputes it. Digesting the output rather than the inputs is the
// point — an input list has to be kept in step with the derivation by hand, and
// silently goes stale the day the derivation grows a dependency.
export function useActiveCharacterDerived<T>(
  compute: (c: Character, fight: SceneState | null) => T,
  digest: (value: T) => string,
): T | null {
  const tab = useAppStore((s) => s.selectedGameTab);
  useActiveCharacterSelector((c, fight) => digest(compute(c, fight)));
  const c = readActiveCharacter(tab);
  return c ? compute(c, isFightTab(tab) ? useCombatStore.getState() : null) : null;
}
