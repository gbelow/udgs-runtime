import { useMemo } from "react";
import { toast } from "sonner";
import { getScenePresets } from "../domain/campaign/rules/scenes";
import { ScenePresetSchema, type ScenePreset } from "../domain/campaign/types";
import { addSceneMember, addSceneParty, removeSceneMember, removeSceneParty, setScenePartyVisitor, renameSceneParty, setSceneMember } from "../domain/campaign/commands/scenePreset";
import { BOTS, getOwnerOptions } from "../domain/profiles";
import type { Character } from "../domain/types";
import { isBaseCharacter } from "../domain/utils";
import { useAppStore } from "../stores/useAppStore";
import { useBoardMapList } from "./useBoardMaps";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useGmBar } from "./useControl";
import type { Coord } from "../domain/scene/types";
import { getPresetBoardView, getSceneMaterials } from "../domain/scene/projections/prepared";
import { paintPresetSpawn } from "../domain/scene/commands/presetSpawn";

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

// A prepared scene's battle map in its editor, with the parties' spawn areas
// on it, and the brush that paints a party's area (or, with none, takes cells
// out of every area). No map when the scene names none the screen has.
export function useScenePresetBoard(value: Record<string, unknown>, onChange: (value: Record<string, unknown>) => void) {
  const boardMaps = useAppStore((s) => s.boardMaps);
  const preset = useMemo(() => ScenePresetSchema.parse(value), [value]);
  const map = useMemo(() => getSceneMaterials({ board: preset.board, keys: [] }, boardMaps, {}).board, [preset.board, boardMaps]);
  const view = useMemo(() => (map ? getPresetBoardView(map, preset) : null), [map, preset]);
  return {
    view,
    paint: (party: number | null, cell: Coord, radius: number) => {
      if (map) onChange({ ...value, parties: paintPresetSpawn(map, party, cell, radius)(preset).parties });
    },
  };
}
