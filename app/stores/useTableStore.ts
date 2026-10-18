import { create } from 'zustand'

// This screen's link to the table through the relay: whether it hosts the
// table or joined it, the campaign whose table it is, how the link stands,
// and who has joined, for a host. A link that drops is opened again by
// itself, a little later each time, until it has tried `MAX_ATTEMPTS` times.
export type TableMode = 'host' | 'guest'
export type TableStatus = 'connecting' | 'open' | 'noHost' | 'closed'
export type TableGuest = { id: string; profile: string }

// The press a guest has sent and the host has not yet answered: the screen
// sends no other until it is, and says why when it never was.
type Pending = { id: string; timer: ReturnType<typeof setTimeout>; fail: (why: string) => void }

type TableStore = {
  mode: TableMode | null
  // the campaign's id, which names the table's room, and its name
  room: string | null
  roomName: string
  profile: string | null
  status: TableStatus
  // why the link closed, when it closed by itself
  why: string | null
  // how many times the link has been opened again since it last stood
  attempt: number
  guests: TableGuest[]
  socket: WebSocket | null
  pending: Pending | null
  open: (mode: TableMode, room: string, roomName: string, profile: string) => void
  close: () => void
  setStatus: (status: TableStatus) => void
  setGuests: (guests: TableGuest[]) => void
  press: (id: string, fail: (why: string) => void) => void
  settle: (id: string) => void
  abandon: (why: string) => void
}

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? 'ws://localhost:8787'

export const MAX_ATTEMPTS = 12
const FIRST_DELAY = 1000
const LAST_DELAY = 15000
const ANSWER_WITHIN = 5000
const BAD_REQUEST = 4000

const delayOf = (attempt: number) => Math.min(LAST_DELAY, FIRST_DELAY * 2 ** attempt) * (0.5 + Math.random() / 2)

let retrying: ReturnType<typeof setTimeout> | undefined

export const useTableStore = create<TableStore>((set, get) => {
  const connect = (mode: TableMode, room: string, roomName: string, profile: string, attempt: number) => {
    clearTimeout(retrying)
    get().abandon('the link to the table was opened again')
    get().socket?.close()
    const socket = new WebSocket(`${RELAY_URL}?room=${encodeURIComponent(room)}&as=${mode}&profile=${encodeURIComponent(profile)}`)
    set({ mode, room, roomName, profile, socket, status: 'connecting', attempt, guests: [], ...(attempt === 0 ? { why: null } : {}) })
    socket.onopen = () => set(mode === 'host' ? { status: 'open', attempt: 0, why: null } : { attempt: 0, why: null })
    socket.onclose = (e) => {
      if (get().socket !== socket) return
      const why = e.reason || (e.code === 1006 ? 'the relay could not be reached' : null)
      get().abandon('the link to the table dropped')
      if (e.code === BAD_REQUEST || attempt >= MAX_ATTEMPTS) {
        set({ socket: null, status: 'closed', guests: [], why })
        return
      }
      set({ socket: null, status: 'connecting', guests: [], why, attempt: attempt + 1 })
      retrying = setTimeout(() => connect(mode, room, roomName, profile, attempt + 1), delayOf(attempt))
    }
  }

  return {
    mode: null,
    room: null,
    roomName: '',
    profile: null,
    status: 'closed',
    why: null,
    attempt: 0,
    guests: [],
    socket: null,
    pending: null,

    open: (mode, room, roomName, profile) => connect(mode, room, roomName, profile, 0),

    close: () => {
      clearTimeout(retrying)
      get().abandon('the link to the table was closed')
      const socket = get().socket
      set({ socket: null, mode: null, room: null, roomName: '', profile: null, status: 'closed', why: null, attempt: 0, guests: [] })
      socket?.close()
    },

    setStatus: (status) => set(status === 'open' ? { status, attempt: 0, why: null } : { status }),
    setGuests: (guests) => set({ guests }),

    press: (id, fail) => {
      const timer = setTimeout(() => get().abandon('the host did not confirm it'), ANSWER_WITHIN)
      set({ pending: { id, timer, fail } })
    },

    settle: (id) => {
      const pending = get().pending
      if (pending?.id !== id) return
      clearTimeout(pending.timer)
      set({ pending: null })
    },

    abandon: (why) => {
      const pending = get().pending
      if (!pending) return
      clearTimeout(pending.timer)
      set({ pending: null })
      pending.fail(why)
    },
  }
})
