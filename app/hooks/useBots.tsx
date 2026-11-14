import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { realDice } from "../components/utils";
import { barOf, playOf } from "../net/parts";
import { BOTS } from "../domain/profiles";
import { getBotSeats } from "../domain/bot/bots";
import { CONTEST_WINDOW_MS, getNextMove, getPace, type MoveOptions } from "../domain/bot/seat";
import { useCombatStore } from "../stores/useCombatStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useTableStore } from "../stores/useTableStore";
import { useBotLogStore } from "../stores/useBotLogStore";
import { useGuestViewerCheck } from "./useControl";
import { useThrower } from "./useDieCalls";

// What the bots played this round on this screen and why, newest first.
export function useBotLog() {
  const round = useCombatStore((s) => s.round);
  const entries = useBotLogStore((s) => s.entries);
  return useMemo(() => entries.filter((e) => e.round === round), [entries, round]);
}

// A beat between a bot's moves, so that the table can follow them.
const BEAT_MS = 300;

// How many times in a row a bot may make the very same move before the bots
// stop, so that a bot pressing something that leads nowhere does not spin.
const REPEATS = 3;

// The bots at the fight, played on the screen that keeps the table (never a
// guest's): after every change to the fight, the next move of whichever bot
// seat has one (`getNextMove`), sent as a guest's press is, as the bot, and
// held back as long as `getPace` says. A move the table refuses stops the
// bots until the fight changes, and so does the same move made more than
// `REPEATS` times in a row, until another is to be made.
export function useBots() {
  const mode = useTableStore((s) => s.mode);
  const viewerOf = useGuestViewerCheck();
  const thrower = useThrower();
  const live = useRef({ viewerOf, thrower });
  live.current = { viewerOf, thrower };

  useEffect(() => {
    if (mode === 'guest') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // when the turn a bot's character holds was first seen held
    let held: { turn: number; at: number } | null = null;
    // the seat asked first, after the one that moved last
    let from = 0;
    // the last move made, and how many times in a row
    let last = '';
    let repeats = 0;

    const play = () => {
      timer = null;
      const { viewerOf, thrower } = live.current;
      const state = useCombatStore.getState();
      const ownerOf = viewerOf(BOTS[0].id, false).ownerOf;
      const seats = getBotSeats(state, ownerOf);
      if (seats.length === 0) return;
      const opts: MoveOptions = {
        ctx: { thrower: realDice, newId: () => crypto.randomUUID() },
        botDice: realDice,
        rngOf: () => Math.random,
        autoTable: false,
        viewerOf: (seat) => viewerOf(seat.profile ?? seat.id, false),
      };
      const { move, next, refused } = getNextMove(state, seats, opts, from);
      if (refused.length) console.warn('[bots]', refused);
      if (!move) return;
      const said = JSON.stringify([move.by, move.who, move.commands]);
      repeats = said === last ? repeats + 1 : 1;
      last = said;
      if (repeats > REPEATS) {
        if (repeats === REPEATS + 1) {
          toast.error('A bot keeps making the same move: the bots stop until something else happens.');
          useBotLogStore.getState().add({ round: state.round, who: (move.who && state.characters[move.who]?.name) || move.by, why: move.why, refused: 'the same move again: stopped' });
        }
        return;
      }
      from = next;
      const pace = getPace(state, seats, move);
      if (pace === 'contested') return;
      if (pace === 'contestable') {
        const now = Date.now();
        if (held?.turn !== state.turn) held = { turn: state.turn, at: now };
        const left = held.at + CONTEST_WINDOW_MS - now;
        if (left > 0) { timer = setTimeout(play, left); return; }
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
        if (Object.values(useCombatStore.getState().calls).some((c) => c.die === null)) return;
      }
    };
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(play, BEAT_MS);
    };

    soon();
    const offCombat = useCombatStore.subscribe(soon);
    const offOwners = useCampaignStore.subscribe((s, before) => { if (s.owners !== before.owners) soon(); });
    return () => { offCombat(); offOwners(); if (timer) clearTimeout(timer); };
  }, [mode]);
}
