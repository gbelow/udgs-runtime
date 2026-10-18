import { useCombatStore } from "../stores/useCombatStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import type { TableGuest, TableStatus } from "../stores/useTableStore";
import { apply, diff } from "./diff";
import { viewFor } from "./view";
import { readShared, sharedOf, type CommandMessage, type FromRelay, type Shared, type ToGuest, type ToHost } from "./protocol";

const current = (): Shared => sharedOf(useCombatStore.getState(), useCampaignStore.getState());

// What a guest is told of a press the host refused: the reason may name
// someone the guest is not shown, and their own screen has refused what it
// could already see.
const REFUSED = 'it did not stand at the table';

// The host's side of the table: every change to the stores goes to each guest
// as what changed in their own view of it since the last one sent them
// (`viewFor`: a GM sees all, a player what concerns the characters they play),
// a guest who joins or asks again gets their whole view, and a guest's command
// is played as sent by them — `play` answers why it was refused, or null.
// Stops when the returned function is called.
export function hostTable(socket: WebSocket, play: (message: CommandMessage, profile: string) => string | null, onGuests: (guests: TableGuest[]) => void): () => void {
  const guests = new Map<string, { profile: string; sent: Shared; seq: number }>();
  let queued = false;

  const send = (to: string, message: ToGuest) => sendToGuest(socket, to, message);
  const flush = () => {
    queued = false;
    const next = current();
    for (const [id, guest] of guests) {
      const view = viewFor(next, guest.profile);
      const patch = diff(guest.sent, view);
      guest.sent = view;
      if (patch) send(id, { kind: 'patch', seq: ++guest.seq, patch });
    }
  };
  const sendWhole = (to: string) => {
    const guest = guests.get(to);
    if (!guest) return;
    guest.sent = viewFor(current(), guest.profile);
    send(to, { kind: 'full', seq: guest.seq, state: guest.sent });
  };
  const schedule = () => { if (!queued) { queued = true; queueMicrotask(flush); } };
  const showGuests = () => onGuests([...guests].map(([id, { profile }]) => ({ id, profile })));

  const stops = [useCombatStore.subscribe(schedule), useCampaignStore.subscribe(schedule)];
  socket.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as FromRelay;
    if (m.kind === 'join') { guests.set(m.from, { profile: m.profile, sent: current(), seq: 0 }); sendWhole(m.from); showGuests(); }
    else if (m.kind === 'leave') { guests.delete(m.from); showGuests(); }
    else if (m.data.kind === 'resync') sendWhole(m.from);
    else {
      let why: string | null;
      try { why = play(m.data, m.profile); }
      catch (error) { console.error('a guest command could not be played', m.data, error); why = 'it could not be played'; }
      send(m.from, why ? { kind: 'refused', id: m.data.id, why: REFUSED } : { kind: 'ack', id: m.data.id });
    }
  };
  return () => { stops.forEach((stop) => stop()); socket.onmessage = null; };
}

// The host's guests are told the table goes on in another room, before the
// host leaves this one for it.
export function announceMove(socket: WebSocket, room: string, roomName: string) {
  sendToGuest(socket, '*', { kind: 'moved', room, roomName });
}

// A message from the host to guest `to`, or to every guest with '*'.
function sendToGuest(socket: WebSocket, to: string, message: ToGuest) {
  socket.send(`${to}\n${JSON.stringify(message)}`);
}

export function landShared(state: Shared) {
  useCombatStore.setState(state.scene);
  useCampaignStore.setState(state.campaign);
}

// A guest's side: the stores hold whatever the host last sent, the whole
// state once and every change after it in order; a change missed asks for
// the whole state again. A table that moves is followed to its new room.
export function joinTable(socket: WebSocket, onStatus: (status: TableStatus) => void, onAnswer: (id: string, why: string | null) => void, onMoved: (room: string, roomName: string) => void): () => void {
  let base: Shared | null = null;
  let seq = 0;

  const land = (state: Shared) => {
    base = state;
    landShared(state);
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
    else if (m.kind === 'ack') onAnswer(m.id, null);
    else if (m.kind === 'refused') onAnswer(m.id, m.why);
    else if (m.kind === 'moved') onMoved(m.room, m.roomName);
    else { base = null; onStatus('noHost'); }
  };
  return () => { socket.onmessage = null; };
}

// A press from a guest's screen, sent to the host to play.
export function sendToHost(socket: WebSocket, message: ToHost) {
  socket.send(JSON.stringify(message));
}
