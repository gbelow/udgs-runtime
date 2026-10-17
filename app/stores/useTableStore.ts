import { create } from 'zustand'

// This screen's link to the table through the relay: whether it hosts the
// table or joined it, how the link stands, and who has joined, for a host.
export type TableMode = 'host' | 'guest'
export type TableStatus = 'connecting' | 'open' | 'noHost' | 'closed'
export type TableGuest = { id: string; profile: string }

type TableStore = {
  mode: TableMode | null
  status: TableStatus
  // why the link closed, when it closed by itself
  why: string | null
  guests: TableGuest[]
  socket: WebSocket | null
  open: (mode: TableMode, room: string, profile: string) => void
  close: () => void
  setStatus: (status: TableStatus) => void
  setGuests: (guests: TableGuest[]) => void
}

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? 'ws://localhost:8787'

export const useTableStore = create<TableStore>((set, get) => ({
  mode: null,
  status: 'closed',
  why: null,
  guests: [],
  socket: null,

  open: (mode, room, profile) => {
    get().socket?.close()
    const socket = new WebSocket(`${RELAY_URL}?room=${encodeURIComponent(room)}&as=${mode}&profile=${encodeURIComponent(profile)}`)
    set({ mode, socket, status: 'connecting', why: null, guests: [] })
    if (mode === 'host') socket.onopen = () => set({ status: 'open' })
    socket.onclose = (e) => {
      if (get().socket !== socket) return
      set({ socket: null, status: 'closed', guests: [], why: e.reason || (e.code === 1006 ? 'the relay could not be reached' : null) })
    }
  },

  close: () => {
    const socket = get().socket
    set({ socket: null, mode: null, status: 'closed', why: null, guests: [] })
    socket?.close()
  },

  setStatus: (status) => set({ status }),
  setGuests: (guests) => set({ guests }),
}))
