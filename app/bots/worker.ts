import { rollD10 } from '../domain/play/dice'
import { makeBotPlayer, type BotAnswer, type ToBots } from './player'

// The bots' thread: every message is heard as it comes, and once nothing has
// come for `SETTLE_MS` they decide, for the fight as it then stands. What they
// decide is given `BEAT_MS` after the last message, so that the table can
// follow them, and only if nothing has come since. The time is kept here, since
// a page in a hidden tab has its timers slowed and a thread has not.
const SETTLE_MS = 30
const BEAT_MS = 300

// What the thread says: an answer, or why none could be made for that number.
export type FromBots = BotAnswer | { seq: number; error: string }

const player = makeBotPlayer({ dice: (explodes) => rollD10(explodes, Math.random), rng: Math.random, newId: () => crypto.randomUUID() })

let seq = 0
let told = 0
let timer: ReturnType<typeof setTimeout> | undefined

const say = (message: FromBots) => self.postMessage(message)

const failed = (error: unknown) => say({ seq, error: error instanceof Error ? error.stack ?? error.message : String(error) })

function think() {
  try {
    const answer = player.think()
    if (answer) timer = setTimeout(() => say(answer), Math.max(0, told + BEAT_MS - performance.now()))
  } catch (error) {
    failed(error)
  }
}

self.onmessage = ({ data }: MessageEvent<ToBots>) => {
  if (data.kind === 'tell') seq = data.seq
  told = performance.now()
  clearTimeout(timer)
  try {
    player.hear(data)
    timer = setTimeout(think, SETTLE_MS)
  } catch (error) {
    failed(error)
  }
}
