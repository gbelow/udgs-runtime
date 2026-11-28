import { create } from 'zustand'
import { getGround, isSameGround, type CampaignInPlay, type Ground } from '../domain/saves'
import type { CampaignCharacter } from '../domain/types'

// What this screen keeps of the campaign in play between visits, in the
// browser's IndexedDB: for each profile, one autosave per campaign, by its
// id, and which was played last. The demo keeps one of its own, with how the
// visitor was playing it (`demo`). Nothing of it leaves the browser. What
// the save keeps apart (the dead, the ground) is an entry of its own beside
// it, written only when given.
export type Autosave = { save: unknown; characters: unknown[]; at: number; demo?: unknown; fallen?: unknown[]; ground?: unknown }
const PARTS = ['fallen', 'ground'] as const

const DB = 'chargenfallow'
const STORE = 'autosave'
const keyOf = (profile: string, id: string) => `${profile}/${id}`
const lastOf = (profile: string) => `${profile}/last`
// what the bots of its fight remember, kept on its own since it changes after the fight does
const botsOf = (profile: string, id: string) => `${keyOf(profile, id)}/bots`
const partOf = (profile: string, id: string, part: string) => `${keyOf(profile, id)}/${part}`

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
    tx.onabort = () => reject(tx.error ?? new DOMException('the transaction was aborted', 'AbortError'))
  })
}

export async function readAutosave(profile: string, id: string): Promise<Autosave | undefined> {
  let parts: IDBRequest[] = []
  const main = await run<Autosave>('readonly', (s) => {
    parts = PARTS.map((part) => s.get(partOf(profile, id, part)))
    return s.get(keyOf(profile, id))
  })
  if (!main) return undefined
  return { ...main, ...Object.fromEntries(PARTS.flatMap((part, i) => (parts[i].result === undefined ? [] : [[part, parts[i].result]]))) }
}
export const readLastAutosaveId = (profile: string) => run<string>('readonly', (s) => s.get(lastOf(profile)))
export const writeAutosave = (profile: string, id: string, { fallen, ground, ...a }: Autosave) => run('readwrite', (s) => {
  s.put(a, keyOf(profile, id))
  if (fallen !== undefined) s.put(fallen, partOf(profile, id, 'fallen'))
  if (ground !== undefined) s.put(ground, partOf(profile, id, 'ground'))
  s.put(id, lastOf(profile))
})
export const dropAutosave = (profile: string, id: string) => run('readwrite', (s) => {
  s.delete(keyOf(profile, id))
  s.delete(botsOf(profile, id))
  PARTS.forEach((part) => s.delete(partOf(profile, id, part)))
})
export const readBotMemories = (profile: string, id: string) => run<unknown>('readonly', (s) => s.get(botsOf(profile, id)))
export const writeBotMemories = (profile: string, id: string, memories: unknown) => run('readwrite', (s) => { s.put(memories, botsOf(profile, id)) })

// Runs `write` when asked to, one at a time, and again once it is done if
// asked meanwhile, so that the last state is always the one written.
// `settled`: the write under way, if any.
export function makeWriter(write: () => Promise<void>): { ask: () => void; settled: () => Promise<void> | null } {
  let queued = false
  let busy = false
  let again = false
  let under: Promise<void> | null = null
  const loop = async () => {
    try { do { again = false; await write() } while (again) }
    catch (err) { console.error('Autosave failed:', err) }
    finally { busy = false }
  }
  const flush = () => {
    queued = false
    if (busy) { again = true; return }
    busy = true
    under = loop()
  }
  return {
    ask: () => {
      if (queued) return
      queued = true
      queueMicrotask(flush)
    },
    settled: () => under,
  }
}

// When the campaign in play was last autosaved on this screen, for the
// screen to show beside when it was saved.
export const useAutosaveStore = create<{ at: number | null; set: (at: number | null) => void }>((set) => ({
  at: null,
  set: (at) => set({ at }),
}))

// Which of what a save keeps apart a storage already holds, by reference to
// the state it was written from: a write sends only what changed since the
// last one marked, and everything for another campaign.
export function makeKeptParts() {
  let kept: { id: string; fallen: object; ground: Ground | null; sheets: WeakSet<CampaignCharacter> } | null = null
  const sameCampaign = (id: string) => (kept?.id === id ? kept : null)
  return {
    // the dead, whole, when any of them changed
    fallen(id: string, t: CampaignInPlay): CampaignCharacter[] | undefined {
      return sameCampaign(id)?.fallen === t.campaign.fallen ? undefined : Object.values(t.campaign.fallen).flat()
    },
    // the dead the storage does not hold as they are now
    newSheets(id: string, t: CampaignInPlay): CampaignCharacter[] {
      const was = sameCampaign(id)
      return Object.values(t.campaign.fallen).flat().filter((c) => !was?.sheets.has(c))
    },
    // the ground, when it changed; null where the fight has no board
    ground(id: string, t: CampaignInPlay): Ground | null | undefined {
      const was = sameCampaign(id)
      const ground = getGround(t.fight)
      return was && isSameGround(was.ground, ground) ? undefined : ground
    },
    mark(id: string, t: CampaignInPlay) {
      const sheets = new WeakSet<CampaignCharacter>()
      Object.values(t.campaign.fallen).flat().forEach((c) => sheets.add(c))
      kept = { id, fallen: t.campaign.fallen, ground: getGround(t.fight), sheets }
    },
    forget() { kept = null },
  }
}
