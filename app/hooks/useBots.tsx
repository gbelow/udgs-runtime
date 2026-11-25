import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { startBots, type Bots } from "../bots/client";
import type { BotAnswer } from "../bots/player";
import { barOf, playOf } from "../net/parts";
import { sendToHost } from "../net/session";
import { getOwner } from "../domain/profiles";
import { getBotSeats } from "../domain/bot/bots";
import { TABLE } from "../domain/bot/seat";
import { useCombatStore } from "../stores/useCombatStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { readFight, subscribeFight, useFight } from "../stores/useKeptFight";
import { useTableStore } from "../stores/useTableStore";
import { useBotLogStore } from "../stores/useBotLogStore";
import { useBotMemoryStore } from "../stores/useBotMemoryStore";
import { useGmBar, useGuestViewerCheck } from "./useControl";
import { useThrower } from "./useDieCalls";

// What the bots played this round on this screen and why, newest first.
export function useBotLog() {
  const round = useCombatStore((s) => s.round);
  const entries = useBotLogStore((s) => s.entries);
  return useMemo(() => entries.filter((e) => e.round === round), [entries, round]);
}

// The bots' pause: whether any bot is in the fight, whether they are paused,
// the switch and why it is closed to whoever is at the screen, and the space
// bar's press of it over the board, none while the GM keeps it off or no bot
// is in the fight. The bots play on the host's screen, so a guest's press goes
// there.
export function useBotsPaused() {
  const paused = useBotLogStore((s) => s.paused);
  const open = useBotLogStore((s) => s.open);
  const owners = useCampaignStore((s) => s.owners);
  const inPlay = useFight((s) => getBotSeats(s, (id) => getOwner(id, owners)).length > 0);
  const gmBar = useGmBar();
  const bar = open ? null : gmBar;
  const toggle = () => {
    if (bar !== null) return;
    const { mode, socket } = useTableStore.getState();
    if (mode !== 'guest') useBotLogStore.getState().setPaused(!paused);
    else if (socket) sendToHost(socket, { kind: 'pauseBots', paused: !paused });
  };
  return { paused, inPlay, bar, toggle, space: open && (inPlay || paused) ? toggle : undefined } as const;
}

// The GM's switch for whether the space bar pauses the bots, for everyone at
// the table; a guest's screen keeps none of the bots' settings.
export function useBotsPauseSetting() {
  const open = useBotLogStore((s) => s.open);
  const guest = useTableStore((s) => s.mode === 'guest');
  const gmBar = useGmBar();
  const bar = gmBar ?? (guest ? "set on the host's screen" : null);
  return { open, bar, toggle: () => { if (bar === null) useBotLogStore.getState().setOpen(!open); } } as const;
}

// The bots at the fight, played on the screen that keeps the table (never a
// guest's): their thread (bots/client.ts) is told of every change to the fight
// and answers with what is done next (bot/live.ts `getLiveStep`), a move sent as
// a guest's press is, as the bot. It runs while the fight has a bot in it, or
// the table presses for itself. A move the table refuses stops the bots until the fight changes. While they
// are paused, they decide nothing, but the table still presses for the GM
// nobody plays and the dice called for are thrown (`MoveOptions` `paused`).
// `table`: whether the table presses for a GM nobody plays (bot/autoTable.ts),
// as the demo has none, and whether it holds the first round back until it is
// told to begin.
export type BotTable = { auto: boolean; holdStart: boolean };
const WITH_GM: BotTable = { auto: false, holdStart: false };

export function useBots(table: BotTable = WITH_GM) {
  const { auto, holdStart } = table;
  const mode = useTableStore((s) => s.mode);
  const viewerOf = useGuestViewerCheck();
  const thrower = useThrower();
  const live = useRef({ viewerOf, thrower, auto, holdStart });
  live.current = { viewerOf, thrower, auto, holdStart };
  // tells the thread how things stand
  const tell = useRef<() => void>(() => {});

  // the demo's pause is the visitor's, whatever this browser remembers
  useEffect(() => { if (!auto && mode !== 'guest') useBotLogStore.getState().recall(); }, [auto, mode]);

  useEffect(() => {
    if (mode === 'guest') return;
    let bots: Bots | null = null;

    // whether the answer's first press was made
    const press = ({ step, refused }: BotAnswer): boolean => {
      if (refused.length) console.warn('[bots]', refused);
      if (step.do === 'nothing') return false;
      const { move } = step;
      const { viewerOf, thrower } = live.current;
      const state = readFight();
      const entry = { round: state.round, who: (move.who && state.characters[move.who]?.name) || move.by, why: move.why };
      if (step.do === 'stop') {
        if (step.first) {
          toast.error('A bot keeps making the same move: the bots stop until something else happens.');
          useBotLogStore.getState().add({ ...entry, refused: 'the same move again: stopped' });
        }
        return false;
      }
      const viewer = move.as === null ? TABLE : viewerOf(move.as, false);
      let played = false;
      for (const command of move.commands) {
        const why = barOf('scene', command, viewer);
        if (why) {
          toast.error(`A bot was refused: ${why}.`);
          useBotLogStore.getState().add({ ...entry, refused: `${command.kind}: ${why}` });
          return played;
        }
        if (!played) useBotLogStore.getState().add({ ...entry, refused: null });
        playOf('scene', command, thrower);
        played = true;
        if (Object.values(readFight().calls).some((c) => c.die === null)) break;
      }
      return played;
    };
    const fail = (why: string, over: boolean) => {
      console.error('[bots]', why);
      if (over) toast.error('The bots could not be started. Reload the page to try again.', { id: 'bots-failed', duration: Infinity });
      else toast.error('The bots could not go on: they try again once the fight changes.', { id: 'bots-failed' });
    };
    tell.current = () => {
      const { auto, holdStart } = live.current;
      const state = readFight();
      const { owners } = useCampaignStore.getState();
      if (!auto && getBotSeats(state, (id) => getOwner(id, owners)).length === 0) {
        bots?.stop();
        bots = null;
        return;
      }
      bots ??= startBots(press, fail);
      bots.tell(state, { owners, auto, holdStart, paused: useBotLogStore.getState().paused });
    };

    tell.current();
    const offCombat = subscribeFight(() => tell.current());
    const offOwners = useCampaignStore.subscribe((s, before) => { if (s.owners !== before.owners) tell.current(); });
    const offPaused = useBotLogStore.subscribe((s, before) => { if (s.paused !== before.paused) tell.current(); });
    const offMemory = useBotMemoryStore.subscribe((s, before) => { if (s.restored !== before.restored) tell.current(); });
    return () => { offCombat(); offOwners(); offPaused(); offMemory(); tell.current = () => {}; bots?.stop(); };
  }, [mode]);

  useEffect(() => tell.current(), [auto, holdStart]);
}
