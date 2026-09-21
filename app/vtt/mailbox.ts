import redis from '../redis'
import { isFightId, isSnapshot } from './snapshot'

// One slot per fight, holding the last snapshot either side wrote. The app
// writes after it changes the board; a VTT writes after its tokens move.
// Nothing merges: the newest snapshot is the board.

const KEY = (fight: string) => `vtt:${fight}`
const TTL_SECONDS = 60 * 60 * 24

// The mailbox lives in Redis when it is configured, and in this process
// otherwise, which is enough for a dev server and a VTT on the same machine.
const local = new Map<string, unknown>()
const hasRedis = !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN

export async function readMailbox(fight: string): Promise<unknown | null> {
  if (!isFightId(fight)) return null
  if (!hasRedis) return local.get(KEY(fight)) ?? null
  return (await redis.get(KEY(fight))) ?? null
}

export async function writeMailbox(fight: string, snapshot: unknown): Promise<boolean> {
  if (!isFightId(fight) || !isSnapshot(snapshot)) return false
  if (!hasRedis) {
    local.set(KEY(fight), snapshot)
    return true
  }
  await redis.set(KEY(fight), snapshot, { ex: TTL_SECONDS })
  return true
}
