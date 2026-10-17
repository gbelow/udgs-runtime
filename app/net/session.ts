import { useCombatStore } from "../stores/useCombatStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import type { TableGuest, TableStatus } from "../stores/useTableStore";
import { apply, diff } from "./diff";
import { readShared, sharedOf, type CommandMessage, type FromRelay, type Shared, type ToGuest, type ToHost } from "./protocol";

const current = (): Shared => sharedOf(useCombatStore.getState(), useCampaignStore.getState());

// The host's side of the table: every change to the stores goes to the guests
// as what changed since the last one sent, a guest who joins or asks again
// gets the whole state, and a guest's command is played as sent by them —
// `play` answers why it was refused, or null. Stops when the returned function
// is called.
export function hostTable(socket: WebSocket, play: (message: CommandMessage, profile: string) => string | null, onGuests: (guests: TableGuest[]) => void): () => void {
  const guests = new Map<string, string>();
  let sent = current();
  let seq = 0;
  let queued = false;

  const send = (to: string, message: ToGuest) => socket.send(`${to}\n${JSON.stringify(message)}`);
  const flush = () => {
    queued = false;
    const next = current();
    const patch = diff(sent, next);
    sent = next;
    if (patch && guests.size > 0) send('*', { kind: 'patch', seq: ++seq, patch });
  };
  const sendWhole = (to: string) => { flush(); send(to, { kind: 'full', seq, state: sent }); };
  const schedule = () => { if (!queued) { queued = true; queueMicrotask(flush); } };
  const showGuests = () => onGuests([...guests].map(([id, profile]) => ({ id, profile })));

  const stops = [useCombatStore.subscribe(schedule), useCampaignStore.subscribe(schedule)];
  socket.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as FromRelay;
    if (m.kind === 'join') { guests.set(m.from, m.profile); sendWhole(m.from); showGuests(); }
    else if (m.kind === 'leave') { guests.delete(m.from); showGuests(); }
    else if (m.data.kind === 'resync') sendWhole(m.from);
    else {
      let why: string | null;
      try { why = play(m.data, m.profile); }
      catch (error) { console.error('a guest command could not be played', m.data, error); why = 'it could not be played'; }
      if (why) send(m.from, { kind: 'refused', why });
    }
  };
  return () => { stops.forEach((stop) => stop()); socket.onmessage = null; };
}

// A guest's side: the stores hold whatever the host last sent, the whole
// state once and every change after it in order; a change missed asks for
// the whole state again.
export function joinTable(socket: WebSocket, onStatus: (status: TableStatus) => void, onRefused: (why: string) => void): () => void {
  let base: Shared | null = null;
  let seq = 0;

  const land = (state: Shared) => {
    base = state;
    useCombatStore.setState(state.scene);
    useCampaignStore.setState(state.campaign);
  };

  socket.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as ToGuest;
    if (m.kind === 'full') { seq = m.seq; land(readShared(m.state)); onStatus('open'); }
    else if (m.kind === 'patch') {
      if (!base) return;
      if (m.seq !== seq + 1) { base = null; socket.send(JSON.stringify({ kind: 'resync' } satisfies ToHost)); return; }
      seq = m.seq;
      land(apply(base, m.patch) as Shared);
    }
    else if (m.kind === 'refused') onRefused(m.why);
    else { base = null; onStatus('noHost'); }
  };
  return () => { socket.onmessage = null; };
}

// A press from a guest's screen, sent to the host to play.
export function sendToHost(socket: WebSocket, message: ToHost) {
  socket.send(JSON.stringify(message));
}
