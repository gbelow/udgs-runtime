import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { barOf, playOf } from "../net/parts";
import { hostTable, joinTable } from "../net/session";
import type { CommandMessage } from "../net/protocol";
import { useTableStore } from "../stores/useTableStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useAppStore } from "../stores/useAppStore";
import { useGuestViewerCheck } from "./useControl";
import { useThrower } from "./useDieCalls";
import { useRole } from "./useRole";

// Keeps the screen's link to the table running while it is open, whichever
// tab is shown: a host plays its guests' commands as sent by them, with its
// own dice and ids, and a guest's stores follow the host's.
export function useTableSession() {
  const socket = useTableStore((s) => s.socket);
  const mode = useTableStore((s) => s.mode);
  const viewerOf = useGuestViewerCheck();
  const thrower = useThrower();
  const played = useRef({ viewerOf, thrower });
  played.current = { viewerOf, thrower };

  useEffect(() => {
    if (!socket || !mode) return;
    const { setStatus, setGuests } = useTableStore.getState();
    if (mode === 'guest') return joinTable(socket, setStatus, (why) => toast.error(`The host refused it: ${why}.`));
    return hostTable(socket, ({ part, command, gmMode }: CommandMessage, profile) => {
      const { viewerOf, thrower } = played.current;
      const why = barOf(part, command, viewerOf(profile, gmMode));
      if (why === null) playOf(part, command, thrower);
      return why;
    }, setGuests);
  }, [socket, mode]);
}

// The link to the table as the Run screen offers it: the campaign's GM hosts
// it, a player joins it, each by the campaign open on their screen.
export function useTableLink() {
  const { gmTools } = useRole();
  const profile = useAppStore((s) => s.profile);
  const profileList = useAppStore((s) => s.profileList);
  const room = useCampaignStore((s) => s.file.id);
  const { mode, status, why, guests, open, close } = useTableStore();
  const nameOf = (id: string) => profileList.find((p) => p.id === id)?.name ?? id;
  return {
    mode, status, why,
    guests: guests.map((g) => ({ id: g.id, name: nameOf(g.profile) })),
    offer: gmTools ? 'host' as const : 'guest' as const,
    connect: () => { if (profile) open(gmTools ? 'host' : 'guest', room, profile.id); },
    leave: close,
  } as const;
}
