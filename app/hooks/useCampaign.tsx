import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { deleteCampaign, getCampaignList, loadCampaign, saveCampaign } from "../actions";
import { fromCampaignSave, getCampaignSaveBar, newCampaign, toCampaignSave } from "../domain/saves";
import { getMoveBars, getRosterView, getRosterViewDigest, type RosterView } from "../domain/campaign/projections/roster";
import { addMap, createParty, leaveParty, moveToParty, removeMap, renameParty, splitOff } from "../domain/campaign/commands/parties";
import { getCampaignMaps, getCampaignMapsDigest, type CampaignMapView } from "../domain/campaign/projections/maps";
import { useMapNames } from "./useMap";
import type { Character } from "../domain/types";
import { makeCampaignCharacter } from "../domain/factories";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";

// The campaign in play's parties and who is in them, gated on a digest since
// the view is freshly allocated.
export function useCampaignRoster(): RosterView {
  useCampaignStore(getRosterViewDigest);
  return getRosterView(useCampaignStore.getState());
}

// Why the character being switched cannot join each party, by party.
export function useMoveBars(id: string | null): Record<string, string | null> {
  const digest = useCampaignStore((s) => (id ? JSON.stringify(getMoveBars(s, id)) : '{}'));
  return useMemo(() => JSON.parse(digest), [digest]);
}

// What the GM does to the campaign's parties out of a fight: makes and names
// them, fills them from the catalog, and moves people between them or out of
// every party.
export function useCampaignPartyCommands() {
  const update = useCampaignStore((s) => s.updateCampaignState);
  const load = useCampaignStore((s) => s.loadCharacter);
  const pick = useCampaignStore((s) => s.setActiveCharacter);
  const newId = () => crypto.randomUUID();
  return {
    pick,
    createParty: (name: string) => update(createParty(newId(), name)),
    renameParty: (partyId: string, name: string) => update(renameParty(partyId, name)),
    moveToParty: (id: string, partyId: string) => update(moveToParty(id, partyId)),
    splitOff: (id: string) => update(splitOff(id, newId)),
    leaveParty: (id: string) => update(leaveParty(id)),
    bring: (character: Character, partyId: string) => load(character, partyId),
  } as const;
}

// The campaign's own maps, each a copy of one from the catalog, added and
// taken away.
export function useCampaignMaps(): { maps: CampaignMapView[]; templates: string[]; add: (name: string) => void; remove: (mapId: string) => void } {
  useCampaignStore(getCampaignMapsDigest);
  const update = useCampaignStore((s) => s.updateCampaignState);
  const { mapList, maps: templates } = useMapNames();
  return {
    maps: getCampaignMaps(useCampaignStore.getState()),
    templates,
    add: (name) => update(addMap(crypto.randomUUID(), mapList[name])),
    remove: (mapId) => update(removeMap(mapId)),
  };
}

// The saved campaigns, and the one in play: begun anew, opened from the
// saved ones, named, saved and deleted.
export function useCampaignFiles() {
  const file = useCampaignStore((s) => s.file);
  const setName = useCampaignStore((s) => s.setFileName);
  const openCampaign = useCampaignStore((s) => s.openCampaign);
  const fighting = useCombatStore((s) => Object.keys(s.characters).length > 0);
  const saveBar = getCampaignSaveBar(file.name, fighting);
  const [campaigns, setCampaigns] = useState<{ id: string, name: string }[]>([]);

  const refresh = useCallback(async () => {
    const res = await getCampaignList();
    if (res.ok) setCampaigns(res.data.sort((a, b) => a.name.localeCompare(b.name)));
    else toast.error(res.error);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = () => openCampaign(newCampaign(), { id: crypto.randomUUID(), name: '' });

  const open = async (id: string) => {
    const res = await loadCampaign(id);
    if (!res.ok) { toast.error(res.error); return; }
    const { save, characters } = res.data;
    openCampaign(fromCampaignSave(save, characters.map(makeCampaignCharacter)), { id: save.id, name: save.name });
    toast.success(`Campaign ${save.name} opened.`);
  };

  const save = async () => {
    const s = useCampaignStore.getState();
    const res = await saveCampaign(toCampaignSave(s.file.id, s.file.name, { campaign: s, exploration: s.exploration, downtime: s.downtime }), Object.values(s.characters));
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`Campaign ${s.file.name} saved.`);
    refresh();
  };

  const remove = async (id: string) => {
    const res = await deleteCampaign(id);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success('Campaign deleted.');
    if (id === useCampaignStore.getState().file.id) create();
    refresh();
  };

  return { file, campaigns, saveBar, setName, create, open, save, remove } as const;
}
