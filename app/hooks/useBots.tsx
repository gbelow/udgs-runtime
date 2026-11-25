import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { realDice } from "../components/utils";
import { barOf, playOf } from "../net/parts";
import { sendToHost } from "../net/session";
import { BOTS, getOwner } from "../domain/profiles";
import { getBotSeats } from "../domain/bot/bots";
import { getLiveStep, NEW_LIVE, type Live } from "../domain/bot/live";
import { noteSeats, withNoted, type MoveOptions } from "../domain/bot/seat";
import type { SeatMemories } from "../domain/bot/memory";
import { useCombatStore } from "../stores/useCombatStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { readFight, subscribeFight, useFight } from "../stores/useKeptFight";
import { useTableStore } from "../stores/useTableStore";
import { useBotLogStore } from "../stores/useBotLogStore";
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

// A beat between a bot's moves, so that the table can follow them.
const BEAT_MS = 300;

// The bots at the fight, played on the screen that keeps the table (never a
// guest's): after every change to the fight, what is done next
// (bot/live.ts `getLiveStep`), a move sent as a guest's press is, as the bot.
// A move the table refuses stops the bots until the fight changes. While they
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
  const live = useRef({ viewerOf, thrower });
  live.current = { viewerOf, thrower };

  // the demo's pause is the visitor's, whatever this browser remembers
  useEffect(() => { if (!auto && mode !== 'guest') useBotLogStore.getState().recall(); }, [auto, mode]);

  useEffect(() => {
    if (mode === 'guest') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let kept: Live = NEW_LIVE;
    // what each bot seat remembers of the foes it noticed, noted at every change to the fight
    let memories: SeatMemories = {};
    const note = () => {
      const state = readFight();
      memories = noteSeats(memories, state, getBotSeats(state, live.current.viewerOf(BOTS[0].id, false).ownerOf));
    };

    const play = () => {
      timer = null;
      const { viewerOf, thrower } = live.current;
      const state = readFight();
      const ownerOf = viewerOf(BOTS[0].id, false).ownerOf;
      const seats = getBotSeats(state, ownerOf);
      if (seats.length === 0 && !auto) return;
      const opts: MoveOptions = {
        ctx: { thrower: realDice, newId: () => crypto.randomUUID() },
        botDice: realDice,
        rngOf: () => Math.random,
        autoTable: auto,
        holdStart,
        paused: useBotLogStore.getState().paused,
        viewerOf: (seat) => viewerOf(seat.profile ?? seat.id, false),
        memories,
      };
      const { step, live: next, refused } = getLiveStep(kept, state, seats, opts);
      kept = next;
      if (refused.length) console.warn('[bots]', refused);
      if (step.do === 'nothing') return;
      const { move } = step;
      if (step.do === 'stop') {
        if (step.first) {
          toast.error('A bot keeps making the same move: the bots stop until something else happens.');
          useBotLogStore.getState().add({ round: state.round, who: (move.who && state.characters[move.who]?.name) || move.by, why: move.why, refused: 'the same move again: stopped' });
        }
        return;
      }
      const entry = { round: state.round, who: (move.who && state.characters[move.who]?.name) || move.by, why: move.why };
      for (const command of move.commands) {
        const why = barOf('scene', command, move.viewer);
        if (why) {
          toast.error(`A bot was refused: ${why}.`);
          useBotLogStore.getState().add({ ...entry, refused: `${command.kind}: ${why}` });
          return;
        }
        if (command === move.commands[0]) useBotLogStore.getState().add({ ...entry, refused: null });
        playOf('scene', command, thrower);
        if (command === move.commands[0]) memories = withNoted(memories, move);
        if (Object.values(readFight().calls).some((c) => c.die === null)) return;
      }
    };
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(play, BEAT_MS);
    };

    note();
    soon();
    const offCombat = subscribeFight(() => { note(); soon(); });
    const offOwners = useCampaignStore.subscribe((s, before) => { if (s.owners !== before.owners) soon(); });
    const offPaused = useBotLogStore.subscribe((s, before) => { if (s.paused !== before.paused) soon(); });
    return () => { offCombat(); offOwners(); offPaused(); if (timer) clearTimeout(timer); };
  }, [mode, auto, holdStart]);
}
