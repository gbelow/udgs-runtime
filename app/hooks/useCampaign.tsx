import { useMemo } from "react";
import { toast } from "sonner";
import { deleteCampaign, loadCampaign, saveCampaign } from "../actions";
import { fromCampaignSave, getCampaignSaveBar, newCampaign, toCampaignSave } from "../domain/saves";
import { getMoveBars, getRosterView, getRosterViewDigest, type RosterView } from "../domain/campaign/projections/roster";
import { addMap, createParty, leaveParty, moveToParty, removeMap, renameParty, splitOff } from "../domain/campaign/commands/parties";
import { getCampaignMaps, getCampaignMapsDigest, type CampaignMapView } from "../domain/campaign/projections/maps";
import { useMapNames } from "./useMap";
import type { Character } from "../domain/types";
import type { CampaignUpdater } from "../domain/campaign/types";
import { makeCampaignCharacter } from "../domain/factories";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCampaignRole } from "./useRole";
import { getJournalView } from "../domain/campaign/projections/journal";
import { editNote, removeEntry, writeNote } from "../domain/campaign/commands/journal";
import { useCombatStore } from "../stores/useCombatStore";
import { useAppStore } from "../stores/useAppStore";
import { getMemberRows, setMember, type MemberRole } from "../domain/profiles";
import { useProfileId } from "./useProfile";
import { useActGate } from "./useControl";

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
  const gate = useActGate();
  const asGm = (updater: CampaignUpdater) => { if (gate("gm")) update(updater); };
  return {
    pick,
    createParty: (name: string) => asGm(createParty(newId(), name)),
    renameParty: (partyId: string, name: string) => asGm(renameParty(partyId, name)),
    moveToParty: (id: string, partyId: string) => asGm(moveToParty(id, partyId)),
    splitOff: (id: string) => asGm(splitOff(id, newId)),
    leaveParty: (id: string) => asGm(leaveParty(id)),
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

// The saved campaigns the profile at the screen plays.
export function useCampaignList() {
  const campaigns = useAppStore((s) => s.campaignList);
  const refresh = useAppStore((s) => s.updateCampaignList);
  return { campaigns, refresh } as const;
}

// The saved campaigns, and the one in play: begun anew, opened from the
// saved ones, named, saved and deleted.
export function useCampaignFiles() {
  const file = useCampaignStore((s) => s.file);
  const setName = useCampaignStore((s) => s.setFileName);
  const openCampaign = useCampaignStore((s) => s.openCampaign);
  const setMembers = useCampaignStore((s) => s.setMembers);
  const profile = useProfileId();
  const fighting = useCombatStore((s) => Object.keys(s.characters).length > 0);
  const saveBar = getCampaignSaveBar(file.name, fighting);
  const { campaigns, refresh } = useCampaignList();

  const create = () => openCampaign(newCampaign(), { id: crypto.randomUUID(), name: '', members: profile ? { [profile]: 'gm' } : {} });

  const open = async (id: string) => {
    const res = await loadCampaign(id);
    if (!res.ok) { toast.error(res.error); return; }
    const { save, characters, owners } = res.data;
    openCampaign(fromCampaignSave(save, characters.map(makeCampaignCharacter)), { id: save.id, name: save.name, members: save.members }, owners);
    toast.success(`Campaign ${save.name} opened.`);
  };

  const save = async () => {
    const s = useCampaignStore.getState();
    const res = await saveCampaign(toCampaignSave(s.file.id, s.file.name, s.file.members, { campaign: s, exploration: s.exploration, downtime: s.downtime }), Object.values(s.characters));
    if (!res.ok) { toast.error(res.error); return; }
    setMembers(res.data);
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

// The campaign's journal as the viewer may read it — the GM's notes only for
// one with the GM's tools — narrowed to a party or not, and to each party's
// newest `limit` entries or not, with a note written under the viewer's
// profile, and a note rewritten or an entry thrown away by whoever the view
// says may.
export function useJournal(filter: string | null | 'all', limit?: number) {
  const journal = useCampaignStore((s) => s.journal);
  const names = useCampaignStore((s) => JSON.stringify(Object.entries(s.parties).map(([id, p]) => ({ id, name: p.name }))));
  const update = useCampaignStore((s) => s.updateCampaignState);
  const role = useCampaignRole();
  const profile = useProfileId();
  const options: { id: string, name: string }[] = useMemo(() => JSON.parse(names), [names]);
  const view = useMemo(() => getJournalView({ journal, parties: Object.fromEntries(options.map((p) => [p.id, p])) }, { party: filter, profile, role, limit }), [journal, options, filter, profile, role, limit]);
  return {
    view,
    parties: options,
    write: (party: string | null, text: string, gmOnly: boolean) => update(writeNote(party, text, gmOnly, profile)),
    edit: (id: string, text: string, gmOnly: boolean) => update(editNote(id, text, gmOnly)),
    remove: (id: string) => update(removeEntry(id)),
  } as const;
}

// The party the active character on the roster is in, or null.
export function useActivePartyId(): string | null {
  return useCampaignStore((s) => (s.activeCharacterId ? s.partyOf[s.activeCharacterId] ?? null : null));
}

// Who plays the campaign in play and as what, the profiles that could join
// it, and joining, recasting and taking one out, each refused with its reason
// where it would leave the campaign without a GM.
export function useCampaignMembers() {
  const members = useCampaignStore((s) => s.file.members);
  const setMembers = useCampaignStore((s) => s.setMembers);
  const profiles = useAppStore((s) => s.profileList);
  const me = useProfileId();
  return {
    members: getMemberRows(members, profiles, me),
    others: profiles.filter((p) => !(p.id in members)),
    set: (profile: string, role: MemberRole | null) => setMembers(setMember(members, profile, role)),
  } as const;
}
