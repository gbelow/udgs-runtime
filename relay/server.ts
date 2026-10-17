import { WebSocketServer, type WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'

// The table's relay: one room per campaign, one host in it (the GM's screen,
// the authority) and any number of guests. It carries messages between them
// and reads none: a guest's message reaches the host wrapped with who sent
// it, and the host's reaches every guest, or the one it names, as sent.
//
//   connect   ?room=<campaign id>&as=host|guest&profile=<profile id>
//   host  →   "<guest id>\n<payload>", or "*\n<payload>" for every guest
//   guest →   <payload>, any JSON
//   → host    {"kind":"join"|"leave","from","profile"} and
//             {"kind":"message","from","profile","data":<payload>}
//   → guest   the host's payloads, and {"kind":"noHost"} while it has none

type Guest = { id: string; profile: string; socket: WebSocket }
type Room = { host: WebSocket | null; guests: Map<string, Guest> }

const PORT = Number(process.env.PORT ?? 8787)
const rooms = new Map<string, Room>()
const alive = new WeakSet<WebSocket>()

const roomOf = (id: string): Room => {
  let room = rooms.get(id)
  if (!room) rooms.set(id, (room = { host: null, guests: new Map() }))
  return room
}

const forget = (id: string, room: Room) => {
  if (!room.host && room.guests.size === 0) rooms.delete(id)
}

const notice = (kind: 'join' | 'leave', g: Guest) => JSON.stringify({ kind, from: g.id, profile: g.profile })

const server = new WebSocketServer({ port: PORT, maxPayload: 16 * 1024 * 1024 })

server.on('connection', (socket, request) => {
  const params = new URL(request.url ?? '/', 'http://relay').searchParams
  const roomId = params.get('room')
  const as = params.get('as')
  const profile = params.get('profile') ?? ''
  if (!roomId || (as !== 'host' && as !== 'guest')) return socket.close(4000, 'room and as are needed')

  const room = roomOf(roomId)
  alive.add(socket)
  socket.on('pong', () => alive.add(socket))

  if (as === 'host') {
    if (room.host) return socket.close(4009, 'the table already has a host')
    room.host = socket
    for (const g of room.guests.values()) socket.send(notice('join', g))
    socket.on('message', (raw) => {
      const text = raw.toString()
      const cut = text.indexOf('\n')
      if (cut < 0) return
      const to = text.slice(0, cut)
      const payload = text.slice(cut + 1)
      if (to === '*') for (const g of room.guests.values()) g.socket.send(payload)
      else room.guests.get(to)?.socket.send(payload)
    })
    socket.on('close', () => {
      room.host = null
      for (const g of room.guests.values()) g.socket.send('{"kind":"noHost"}')
      forget(roomId, room)
    })
    return
  }

  const guest: Guest = { id: randomUUID(), profile, socket }
  room.guests.set(guest.id, guest)
  if (room.host) room.host.send(notice('join', guest))
  else socket.send('{"kind":"noHost"}')
  socket.on('message', (raw) => {
    room.host?.send(`{"kind":"message","from":${JSON.stringify(guest.id)},"profile":${JSON.stringify(profile)},"data":${raw.toString()}}`)
  })
  socket.on('close', () => {
    room.guests.delete(guest.id)
    room.host?.send(notice('leave', guest))
    forget(roomId, room)
  })
})

// Connections a proxy dropped without a close are found and closed.
setInterval(() => {
  for (const socket of server.clients) {
    if (!alive.has(socket)) { socket.terminate(); continue }
    alive.delete(socket)
    socket.ping()
  }
}, 30_000)

console.log(`relay listening on :${PORT}`)
