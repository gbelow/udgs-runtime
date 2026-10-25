import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { barOf, playOf } from "../net/parts";
import { announceMove, hostTable, joinTable } from "../net/session";
import type { CommandMessage } from "../net/protocol";
import { useTableStore } from "../stores/useTableStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useAppStore } from "../stores/useAppStore";
import { useGuestViewerCheck } from "./useControl";
import { useThrower } from "./useDieCalls";
import { useRole } from "./useRole";
import { useGameTab } from "./useGameTab";

// Keeps the screen's link to the table running while it is open, whichever
// tab is shown: a host plays its guests' commands as sent by them, with its
// own dice and ids, and a guest's stores follow the host's.
export function useTableSession() {
  const socket = useTableStore((s) => s.socket);
  const mode = useTableStore((s) => s.mode);
  const profile = useAppStore((s) => s.profile);
  const viewerOf = useGuestViewerCheck();
  const thrower = useThrower();
  const played = useRef({ viewerOf, thrower, profile });
  played.current = { viewerOf, thrower, profile };

  useEffect(() => {
    if (!socket || !mode) return;
    const { setStatus, setGuests, settle, abandon } = useTableStore.getState();
    if (mode === 'guest') return joinTable(socket, (status) => {
      setStatus(status);
      if (status === 'noHost') abandon('the host is away');
    }, (id, why) => {
      settle(id);
      if (why) toast.error(`The host refused it: ${why}.`);
    }, (room, roomName) => {
      const { profile } = played.current;
      if (!profile) return;
      useTableStore.getState().open('guest', room, roomName, profile.id);
      toast.info(`The table moved to ${roomName}, a copy of the campaign.`);
    });
    return hostTable(socket, ({ part, command, gmMode }: CommandMessage, profile) => {
      const { viewerOf, thrower } = played.current;
      const why = barOf(part, command, viewerOf(profile, gmMode));
      if (why === null) playOf(part, command, thrower);
      return why;
    }, setGuests);
  }, [socket, mode]);

  // Another campaign opened on the screen leaves the table it was at, but a
  // copy of the table's campaign saved by its host takes the table along,
  // its guests following; the host's own state arriving at a guest is the
  // table's campaign, not another.
  useEffect(() => useCampaignStore.subscribe((s, before) => {
    const { room, mode, socket, open, close } = useTableStore.getState();
    if (!room || s.file.id === before.file.id || s.file.id === room) return;
    const { profile } = played.current;
    if (mode === 'host' && socket && profile && s.file.copiedFrom === room) {
      announceMove(socket, s.file.id, s.file.name);
      open('host', s.file.id, s.file.name, profile.id);
      return;
    }
    close();
    toast.info('Left the table: another campaign is open on this screen.');
  }), []);
}

// Joining the table of campaign `id`, from wherever it is offered: the
// screen goes to the run screen, which follows the host once it is there.
export function useJoinTable(): (id: string, name: string) => void {
  const profile = useAppStore((s) => s.profile);
  const open = useTableStore((s) => s.open);
  const { runTab, setTab } = useGameTab();
  return (id, name) => {
    if (!profile) return;
    open('guest', id, name, profile.id);
    setTab(runTab);
  };
}

// The link to the table as the Run screen offers it: a GM hosts the campaign
// open on their screen; anyone else joins one of the campaigns they play.
export function useTableLink() {
  const { gmTools } = useRole();
  const profile = useAppStore((s) => s.profile);
  const profileList = useAppStore((s) => s.profileList);
  const rows = useAppStore((s) => s.campaignList);
  const file = useCampaignStore((s) => s.file);
  const { mode, room, roomName, status, why, attempt, guests, open, close } = useTableStore();
  const join = useJoinTable();
  const played = useMemo(() => rows.filter((r) => r.member === 'player').map((r) => ({ id: r.id, name: r.name })), [rows]);
  const nameOf = (id: string) => profileList.find((p) => p.id === id)?.name ?? id;
  return {
    mode, status, why, attempt, roomName,
    // the campaign the screen runs: the table's once joined, else the one open
    campaign: mode === 'guest' ? { name: roomName, locked: false } : { name: file.name, locked: file.locked },
    guests: guests.map((g) => ({ id: g.id, name: nameOf(g.profile) })),
    canHost: gmTools,
    played,
    host: () => { if (profile) open('host', file.id, file.name, profile.id); },
    join,
    reconnect: () => { if (profile && mode && room) open(mode, room, roomName, profile.id); },
    leave: close,
  } as const;
}

// Whether the screen joined a table whose state is not on it yet.
export function useTableWaiting(): boolean {
  return useTableStore((s) => s.mode === 'guest' && s.status !== 'open');
}
