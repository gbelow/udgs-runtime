import { create } from 'zustand'

// What this screen keeps of the campaign in play between visits, in the
// browser's IndexedDB: for each profile, one autosave per campaign, by its
// id, and which was played last. Nothing of it leaves the browser.
export type Autosave = { save: unknown; characters: unknown[]; at: number }

const DB = 'chargenfallow'
const STORE = 'autosave'
const keyOf = (profile: string, id: string) => `${profile}/${id}`
const lastOf = (profile: string) => `${profile}/last`

// Opened once and kept, until another tab upgrades the database.
let opened: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); opened = null }
      resolve(req.result)
    }
    req.onerror = () => { opened = null; reject(req.error) }
  })
  return opened
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = act(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req ? req.result : undefined)
    tx.onerror = () => reject(tx.error)
  })
}

export const readAutosave = (profile: string, id: string) => run<Autosave>('readonly', (s) => s.get(keyOf(profile, id)))
export const readLastAutosaveId = (profile: string) => run<string>('readonly', (s) => s.get(lastOf(profile)))
export const writeAutosave = (profile: string, id: string, a: Autosave) => run('readwrite', (s) => { s.put(a, keyOf(profile, id)); s.put(id, lastOf(profile)) })
export const dropAutosave = (profile: string, id: string) => run('readwrite', (s) => { s.delete(keyOf(profile, id)) })

// When the campaign in play was last autosaved on this screen, for the
// screen to show beside when it was saved.
export const useAutosaveStore = create<{ at: number | null; set: (at: number | null) => void }>((set) => ({
  at: null,
  set: (at) => set({ at }),
}))
