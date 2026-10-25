import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { answerRequest, deleteCampaign, loadCampaign, lockCampaign, requestToJoin, saveCampaign, unlockCampaign, withdrawRequest } from "../actions";
import { asCopy, CampaignSaveSchema, fromCampaignSave, getCampaignSaveBar, getDeleteBar, hasPlay, newCampaign, newFile, toFileInfo, toStoredCampaign, type CampaignFileInfo, type CampaignSave, type StoredCampaign } from "../domain/saves";
import { dropAutosave, readAutosave, readLastAutosaveId, useAutosaveStore, writeAutosave } from "../stores/autosave";
import { useTableStore } from "../stores/useTableStore";
import { getMoveBars, getRosterIn, getRosterView, getRosterViewDigest, type RosterView } from "../domain/campaign/projections/roster";
import type { Sequence } from "../domain/campaign/types";
import { getCampaignMaps, getCampaignMapsDigest, type CampaignMapView } from "../domain/campaign/projections/maps";
import { useMapNames } from "./useMap";
import type { Character } from "../domain/types";
import { copyIntoPlay, makeCampaignCharacter } from "../domain/factories";
import { getInPlay, useCampaignStore } from "../stores/useCampaignStore";
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
import { useCampaignDispatch, useTableDispatch } from "./useSceneDispatch";
import { useFighterCount } from "./useCombatState";

// The campaign in play's parties and who is in them, gated on a digest since
// the view is freshly allocated.
export function useCampaignRoster(sequence?: Sequence): RosterView {
  useCampaignStore(getRosterViewDigest);
  const view = getRosterView(useCampaignStore.getState());
  return sequence ? getRosterIn(view, sequence) : view;
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
    startTimeline: (partyId: string) => send({ kind: "startTimeline", args: [partyId] }),
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
        const copy = copyIntoPlay(res.data.character, crypto.randomUUID());
        setOwner(copy.id, res.data.owner);
        send({ kind: "addToRoster", args: [copy, null] });
      }
      toast.success('Request accepted: save the campaign to keep the character on its roster.');
    } else toast.success('Request declined.');
    refresh();
    refreshCharacters();
  };
  return { requests, refresh, accept: (character: string) => answer(character, true), decline: (character: string) => answer(character, false) } as const;
}

function play(save: CampaignSave, characters: unknown[]) {
  useCampaignStore.getState().openCampaign(fromCampaignSave(save, characters.map(makeCampaignCharacter)), toFileInfo(save), save.owners);
}

// The campaign in play as it is written, under `file`.
function stored(file = useCampaignStore.getState().file): StoredCampaign {
  return toStoredCampaign(file, getInPlay(), useCampaignStore.getState().owners);
}

// The autosave write under way, if any: what the campaign in play last
// changed to is not in storage until it is done.
let writing: Promise<void> | null = null;

// Opens campaign `id` where this screen left it, from its autosave; what is
// saved is opened only when there is no autosave or `fresh` asks for it. What
// is being written is waited for first, so the autosave read is the
// campaign's latest.
async function resume(profile: string, id: string, fresh: boolean) {
  await writing;
  const kept = fresh ? undefined : await readAutosave(profile, id).catch(() => undefined);
  const parsed = kept ? CampaignSaveSchema.safeParse(kept.save) : null;
  if (kept && parsed?.success) {
    play(parsed.data, kept.characters);
    useAutosaveStore.getState().set(kept.at);
    toast.success(`Campaign ${parsed.data.name || 'unnamed'} resumed from its autosave.`);
    return;
  }
  const res = await loadCampaign(id);
  if (!res.ok) { toast.error(res.error); return; }
  dropAutosave(profile, id).catch(() => undefined);
  play(res.data.save, res.data.characters);
  useAutosaveStore.getState().set(null);
  toast.success(`Campaign ${res.data.save.name} opened from its save.`);
}

// Whether anything but whom the screen has picked changed.
const changed = <T extends object>(s: T, before: T) =>
  (Object.keys(s) as (keyof T)[]).some((k) => k !== 'activeCharacterId' && s[k] !== before[k]);

// Writes the campaign in play over its saved copy, when it has one that is
// not locked: what a fight's end and an ET's end leave is kept on the server.
async function keepSaved() {
  const { file, setFile } = useCampaignStore.getState();
  if (file.savedAt === 0 || file.locked) return;
  const { save, characters } = stored(file);
  const res = await saveCampaign(save, characters);
  if (!res.ok) { toast.error(res.error); return; }
  setFile({ ...res.data, locked: false });
}

// Keeps the campaign in play in this screen's autosave after every change to
// it, one write at a time with the last state always the one written, and
// brings back the one played last when the profile is picked. The end of a
// fight and the end of an ET also save it to the server. A guest's stores
// follow the host's table and are never kept.
export function useAutosave() {
  const profile = useProfileId();
  useEffect(() => {
    if (!profile) return;
    let queued = false;
    let busy = false;
    let again = false;
    const write = async () => {
      const { file } = useCampaignStore.getState();
      if (file.savedAt === 0 && !hasPlay(getInPlay())) return;
      const at = Date.now();
      try {
        await writeAutosave(profile, file.id, { ...stored(file), at });
        if (useCampaignStore.getState().file.id === file.id) useAutosaveStore.getState().set(at);
      } catch (err) { console.error('Autosave failed:', err); }
    };
    const flush = async () => {
      queued = false;
      if (busy) { again = true; return; }
      busy = true;
      const loop = (async () => {
        try { do { again = false; await write(); } while (again); }
        catch (err) { console.error('Autosave failed:', err); }
        finally { busy = false; }
      })();
      writing = loop;
      await loop;
    };
    const schedule = <T extends object>(s: T, before: T) => {
      if (!changed(s, before) || useTableStore.getState().mode === 'guest' || queued) return;
      queued = true;
      queueMicrotask(flush);
    };

    let keeping = false;
    const keep = () => {
      if (useTableStore.getState().mode === 'guest' || keeping) return;
      keeping = true;
      setTimeout(() => { keeping = false; keepSaved().catch((err) => console.error('Saving the campaign failed:', err)); }, 0);
    };
    const fighters = (s: { characters: object }) => Object.keys(s.characters).length;
    const unsubscribe = [
      useCampaignStore.subscribe(schedule),
      useCombatStore.subscribe(schedule),
      useCombatStore.subscribe((s, before) => { if (fighters(before) > 0 && fighters(s) === 0) keep(); }),
      useCampaignStore.subscribe((s, before) => {
        const [a, b] = [s.exploration, before.exploration];
        if (a.results !== b.results || a.castResults !== b.castResults || a.stayResults !== b.stayResults) keep();
      }),
    ];
    readLastAutosaveId(profile).then((id) => { if (id && useTableStore.getState().mode !== 'guest') resume(profile, id, false); }).catch(() => undefined);
    return () => unsubscribe.forEach((u) => u());
  }, [profile]);
}

// The saved campaigns, and the one in play: begun anew, opened from the
// saved ones where this screen left them or from what is saved, named,
// saved, saved as a copy, locked, unlocked and deleted.
export function useCampaignFiles() {
  const file = useCampaignStore((s) => s.file);
  const setName = useCampaignStore((s) => s.setFileName);
  const openCampaign = useCampaignStore((s) => s.openCampaign);
  const setFile = useCampaignStore((s) => s.setFile);
  const autosavedAt = useAutosaveStore((s) => s.at);
  const profile = useProfileId();
  const fighting = useFighterCount() > 0;
  const sendTable = useTableDispatch();
  const saveBar = getCampaignSaveBar(file.name);
  const deleteBar = getDeleteBar(file.locked);
  const { campaigns, refresh } = useCampaignList();
  const saved = useAppStore((s) => s.campaignList.some((c) => c.id === file.id));
  const refreshCharacters = useAppStore((s) => s.updatePlayerCharacterList);

  const create = () => {
    openCampaign(newCampaign(), newFile(crypto.randomUUID(), profile ? { [profile]: 'gm' } : {}));
    useAutosaveStore.getState().set(null);
  };

  const open = (id: string) => { if (profile) resume(profile, id, false); };
  const restart = () => { if (profile) resume(profile, file.id, true); };

  // Writes the campaign in play under `as` and takes what the server says of
  // it into the file.
  const write = async (action: typeof saveCampaign, as: CampaignFileInfo, done: string) => {
    const { save, characters } = stored(as);
    const res = await action(save, characters);
    if (!res.ok) { toast.error(res.error); return false; }
    setFile({ ...as, ...res.data, locked: action === lockCampaign });
    toast.success(done);
    refresh();
    refreshCharacters();
    return true;
  };

  const save = () => write(saveCampaign, file, `Campaign ${file.name} saved.`);

  const saveAsCopy = async (name: string) => {
    const from = file.id;
    if (await write(saveCampaign, asCopy(file, crypto.randomUUID(), name), `Saved as ${name}, now in play; ${file.name || 'the campaign'} is left as it was.`) && profile)
      dropAutosave(profile, from).catch(() => undefined);
  };

  // A fight being played out is thrown away first: a locked campaign starts
  // with nobody fighting.
  const lock = () => {
    if (fighting) sendTable({ kind: "resetFight", args: [] });
    return write(lockCampaign, file, `Campaign ${file.name} saved and locked: what is saved from now on is saved as a copy.`);
  };

  const unlock = async () => {
    const res = await unlockCampaign(file.id);
    if (!res.ok) { toast.error(res.error); return; }
    setFile({ locked: false });
    toast.success(`Campaign ${file.name} unlocked.`);
    refresh();
  };

  const remove = async (id: string) => {
    const res = await deleteCampaign(id);
    if (!res.ok) { toast.error(res.error); return; }
    if (profile) dropAutosave(profile, id).catch(() => undefined);
    toast.success('Campaign deleted.');
    if (id === useCampaignStore.getState().file.id) create();
    refresh();
  };

  const copiedFrom = file.copiedFrom ? campaigns.find((c) => c.id === file.copiedFrom)?.name ?? null : null;

  return {
    file, campaigns, saved, fighting, copiedFrom,
    savedText: file.savedAt ? stamp(file.savedAt) : null,
    autosavedText: autosavedAt ? stamp(autosavedAt) : null,
    saveBar, deleteBar, setName, create, open, restart, save, saveAsCopy, lock, unlock, remove,
  } as const;
}

function stamp(at: number): string {
  return new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Who plays character `id` in play, the members the GM may give them to, and
// giving them, or taking them back with null; the GM's alone. Kept onto the
// campaign's save when it is saved.
export function usePlayedBy(id: string) {
  const profiles = useAppStore((s) => s.profileList);
  const owner = useCampaignStore((s) => getOwner(id, s.owners)) ?? null;
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
