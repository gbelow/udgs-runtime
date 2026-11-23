import { useMemo } from "react";
import { toast } from "sonner";
import { getScenePresets } from "../domain/campaign/rules/scenes";
import { ScenePresetSchema, type ScenePreset } from "../domain/campaign/types";
import { addSceneMember, addSceneParty, removeSceneMember, removeSceneParty, setScenePartySpawn, setScenePartyVisitor, renameSceneParty, setSceneMember } from "../domain/campaign/commands/scenePreset";
import { BOTS, getOwnerOptions } from "../domain/profiles";
import type { Character } from "../domain/types";
import { isBaseCharacter } from "../domain/utils";
import { useAppStore } from "../stores/useAppStore";
import { useBoardMapList } from "./useBoardMaps";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useGmBar } from "./useControl";

// The scenes prepared in the catalog, for an event to lead to.
export function useScenePresets() {
  return useMemo(() => getScenePresets(), []);
}

// The shared battle maps a prepared scene may be played on, by name.
export function useSharedBoardNames(): string[] {
  const { rows } = useBoardMapList();
  return useMemo(() => rows.filter((r) => r.shared).map((r) => r.name), [rows]);
}

// Who a prepared scene's characters may be given to in the catalog, where no
// campaign's members are known: the GM (null) or a bot.
export const SCENE_PLAYERS: readonly { id: string; name: string }[] = BOTS;

// A prepared scene's parties in its editor: the draft read as a preset, and
// each edit written back onto it. Only a catalog character joins a party; a
// PC picked from the catalog is not one.
export function useScenePresetDraft(value: Record<string, unknown>, onChange: (value: Record<string, unknown>) => void) {
  const preset = ScenePresetSchema.parse(value);
  const apply = (update: (p: ScenePreset) => ScenePreset) => onChange({ ...value, parties: update(preset).parties });
  return {
    parties: preset.parties,
    addParty: () => apply(addSceneParty('')),
    renameParty: (party: number, name: string) => apply(renameSceneParty(party, name)),
    removeParty: (party: number) => apply(removeSceneParty(party)),
    setSpawn: (party: number, spawn: number) => apply(setScenePartySpawn(party, spawn)),
    setVisitor: (party: number, visitor: boolean) => apply(setScenePartyVisitor(party, visitor)),
    addMember: (party: number, character: Character) => {
      if (isBaseCharacter(character)) apply(addSceneMember(party, character.name));
      else toast.error("Only a catalog character can join a prepared scene's party.");
    },
    setCount: (party: number, member: number, count: number) => apply(setSceneMember(party, member, { count })),
    setPlayer: (party: number, member: number, player: string | null) => apply(setSceneMember(party, member, { player })),
    removeMember: (party: number, member: number) => apply(removeSceneMember(party, member)),
  };
}

// Who the characters a waiting scene brings in may be given to before it is
// played: the GM (null), a member of the campaign, or a bot; the GM's to say.
export function useScenePlayerOptions() {
  const profiles = useAppStore((s) => s.profileList);
  const members = useCampaignStore((s) => s.file.members);
  const options = useMemo(() => getOwnerOptions(members, profiles, null), [members, profiles]);
  return { options, bar: useGmBar() };
}
