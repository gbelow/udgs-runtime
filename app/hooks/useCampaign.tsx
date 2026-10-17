import { useMemo } from "react";
import { toast } from "sonner";
import { answerRequest, deleteCampaign, loadCampaign, requestToJoin, saveCampaign, withdrawRequest } from "../actions";
import { fromCampaignSave, getCampaignSaveBar, newCampaign, toCampaignSave } from "../domain/saves";
import { getMoveBars, getRosterView, getRosterViewDigest, type RosterView } from "../domain/campaign/projections/roster";
import { getCampaignMaps, getCampaignMapsDigest, type CampaignMapView } from "../domain/campaign/projections/maps";
import { useMapNames } from "./useMap";
import type { Character } from "../domain/types";
import { makeCampaignCharacter } from "../domain/factories";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCampaignRole } from "./useRole";
import { getJournalView } from "../domain/campaign/projections/journal";
import { getTimelineChart } from "../domain/campaign/projections/timelineChart";
import { getPlacement } from "../domain/campaign/projections/timeline";
import { getClockAt } from "../domain/campaign/rules/clock";
import { useCombatStore } from "../stores/useCombatStore";
import { useAppStore } from "../stores/useAppStore";
import { getJoinView, getMemberRows, getOwner, getOwnerOptions, getRequestRows, setMember, type MemberRole } from "../domain/profiles";
import { useProfileId } from "./useProfile";
import { useActGate, useGmBar } from "./useControl";
import { useCampaignDispatch } from "./useSceneDispatch";

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
  const send = useCampaignDispatch();
  const pick = useCampaignStore((s) => s.setActiveCharacter);
  return {
    pick,
    createParty: (name: string) => send({ kind: "createParty", args: [name] }),
    renameParty: (partyId: string, name: string) => send({ kind: "renameParty", args: [partyId, name] }),
    moveToParty: (id: string, partyId: string) => send({ kind: "moveToParty", args: [id, partyId] }),
    splitOff: (id: string) => send({ kind: "splitOff", args: [id] }),
    leaveParty: (id: string) => send({ kind: "leaveParty", args: [id] }),
    removeFromCampaign: (id: string) => send({ kind: "removeFromRoster", args: [id] }),
    bring: (character: Character, partyId: string) => send({ kind: "addToRoster", args: [makeCampaignCharacter(character), partyId] }),
  } as const;
}

// The campaign's own maps, each a copy of one from the catalog, added and
// taken away.
export function useCampaignMaps(): { maps: CampaignMapView[]; templates: string[]; add: (name: string) => void; remove: (mapId: string) => void } {
  useCampaignStore(getCampaignMapsDigest);
  const send = useCampaignDispatch();
  const { mapList, maps: templates } = useMapNames();
  return {
    maps: getCampaignMaps(useCampaignStore.getState()),
    templates,
    add: (name) => send({ kind: "addMap", args: [mapList[name]] }),
    remove: (mapId) => send({ kind: "removeMap", args: [mapId] }),
  };
}

// The saved campaigns the profile at the screen plays.
export function useCampaignList() {
  const rows = useAppStore((s) => s.campaignList);
  const campaigns = useMemo(() => rows.filter((r) => r.member !== null), [rows]);
  const refresh = useAppStore((s) => s.updateCampaignList);
  return { campaigns, refresh } as const;
}

// Asking to bring one of the profile's characters into a campaign, one
// request per character, and taking a request back.
export function useJoinRequests() {
  const rows = useAppStore((s) => s.campaignList);
  const characters = useAppStore((s) => s.playerCharacterList);
  const refresh = useAppStore((s) => s.updateCampaignList);
  const profile = useProfileId();
  const view = useMemo(() => getJoinView(rows, characters, profile), [rows, characters, profile]);
  const after = async (pending: ReturnType<typeof requestToJoin>, done: string) => {
    const res = await pending;
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(done);
    refresh();
  };
  return {
    ...view,
    refresh,
    request: (campaign: string, character: string) => after(requestToJoin(campaign, character), 'Asked to join.'),
    withdraw: (campaign: string, character: string) => after(withdrawRequest(campaign, character), 'Request withdrawn.'),
  } as const;
}

// The requests to join the campaign in play, as its GM answers them: one
// accepted makes its profile a player and puts the character on the roster in
// no party, theirs, to join one as any member switches party; kept when the
// campaign is saved.
export function useCampaignRequests() {
  const rows = useAppStore((s) => s.campaignList);
  const profiles = useAppStore((s) => s.profileList);
  const refresh = useAppStore((s) => s.updateCampaignList);
  const refreshCharacters = useAppStore((s) => s.updatePlayerCharacterList);
  const id = useCampaignStore((s) => s.file.id);
  const setMembers = useCampaignStore((s) => s.setMembers);
  const setOwner = useCampaignStore((s) => s.setOwner);
  const send = useCampaignDispatch();
  const requests = useMemo(() => getRequestRows(rows, id, profiles), [rows, id, profiles]);
  const answer = async (character: string, accept: boolean) => {
    const res = await answerRequest(id, character, accept);
    if (!res.ok) { toast.error(res.error); return; }
    if (res.data) {
      setMembers(res.data.members);
      if (res.data.character) {
        setOwner(character, res.data.owner);
        send({ kind: "addToRoster", args: [makeCampaignCharacter(res.data.character), null] });
      }
      toast.success('Request accepted: save the campaign to keep the character on its roster.');
    } else toast.success('Request declined.');
    refresh();
    refreshCharacters();
  };
  return { requests, refresh, accept: (character: string) => answer(character, true), decline: (character: string) => answer(character, false) } as const;
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
  const saved = useAppStore((s) => s.campaignList.some((c) => c.id === file.id));
  const refreshCharacters = useAppStore((s) => s.updatePlayerCharacterList);

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
    const res = await saveCampaign(toCampaignSave(s.file.id, s.file.name, s.file.members, { campaign: s, exploration: s.exploration, downtime: s.downtime }), Object.values(s.characters), s.owners);
    if (!res.ok) { toast.error(res.error); return; }
    setMembers(res.data);
    toast.success(`Campaign ${s.file.name} saved.`);
    refresh();
    refreshCharacters();
  };

  const remove = async (id: string) => {
    const res = await deleteCampaign(id);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success('Campaign deleted.');
    if (id === useCampaignStore.getState().file.id) create();
    refresh();
  };

  return { file, campaigns, saved, saveBar, setName, create, open, save, remove } as const;
}

// Who plays character `id` in play, the members the GM may give them to, and
// giving them, or taking them back with null; the GM's alone. Kept onto the
// character's record when the campaign is saved.
export function usePlayedBy(id: string) {
  const listed = useAppStore((s) => s.playerCharacterList);
  const profiles = useAppStore((s) => s.profileList);
  const owner = useCampaignStore((s) => getOwner(id, s.owners, listed)) ?? null;
  const members = useCampaignStore((s) => s.file.members);
  const options = useMemo(() => getOwnerOptions(members, profiles, owner), [members, profiles, owner]);
  const setOwner = useCampaignStore((s) => s.setOwner);
  const bar = useGmBar();
  const gate = useActGate();
  return { owner, options, bar, set: (o: string | null) => { if (gate("gm")) setOwner(id, o); } } as const;
}

// The campaign's journal as the viewer may read it — the GM's notes only for
// one with the GM's tools — narrowed to a party or not, and to each party's
// newest `limit` entries or not, with a note written under the viewer's
// profile, and a note rewritten or an entry thrown away by whoever the view
// says may.
export function useJournal(filter: string | null | 'all', limit?: number) {
  const journal = useCampaignStore((s) => s.journal);
  const names = useCampaignStore((s) => JSON.stringify(Object.entries(s.parties).map(([id, p]) => ({ id, name: p.name }))));
  const send = useCampaignDispatch();
  const role = useCampaignRole();
  const profile = useProfileId();
  const options: { id: string, name: string }[] = useMemo(() => JSON.parse(names), [names]);
  const view = useMemo(() => getJournalView({ journal, parties: Object.fromEntries(options.map((p) => [p.id, p])) }, { party: filter, profile, role, limit }), [journal, options, filter, profile, role, limit]);
  return {
    view,
    parties: options,
    write: (party: string | null, text: string, gmOnly: boolean, clock?: number) => send({ kind: "writeNote", args: [party, text, gmOnly, profile, clock] }),
    edit: (id: string, text: string, gmOnly: boolean) => send({ kind: "editNote", args: [id, text, gmOnly] }),
    remove: (id: string) => send({ kind: "removeEntry", args: [id] }),
  } as const;
}

// Every party's timeline on one axis with the journal laid along it, as the
// viewer may read it.
export function useTimelineChart() {
  const journal = useCampaignStore((s) => s.journal);
  const parties = useCampaignStore((s) => s.parties);
  const role = useCampaignRole();
  return useMemo(() => getTimelineChart({ journal, parties }, { role }), [journal, parties, role]);
}

// Bringing a party to the day and ET of the timeline: what that offers or why
// it cannot be, and doing it, placed there or living the time between.
export function usePlacement(partyId: string, day: number, et: number) {
  const parties = useCampaignStore((s) => s.parties);
  const send = useCampaignDispatch();
  const to = getClockAt(day, et);
  const placement = useMemo(() => getPlacement(parties, partyId, to), [parties, partyId, to]);
  return {
    placement,
    place: (how: 'place' | 'pass') => send(how === 'place' ? { kind: "placeOnTimeline", args: [partyId, to] } : { kind: "passTimeTo", args: [partyId, to] }),
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
