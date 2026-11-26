import { diff } from '../net/diff'
import { sharedSceneOf } from '../net/protocol'
import type { SceneState } from '../domain/scene/types'
import { useBotMemoryStore } from '../stores/useBotMemoryStore'
import { usePlaybackStore } from '../stores/usePlaybackStore'
import type { BotAnswer, BotsTable, ToBots } from './player'
import type { FromBots } from './worker'

// The bots' thread as the screen that keeps the table holds it: told of the
// fight by what changed in it, numbered, and giving each answer that is still
// about the fight as it stands, to be pressed once the board has played what
// came before it.
export type Bots = {
  // what is so now; nothing is sent where nothing changed
  tell: (fight: SceneState, table: BotsTable) => void
  stop: () => void
}

type Running = { seq: number; answered: number; failed: boolean }

// The thread running on this screen, if any.
let running: Running | null = null

// Whether the bots have said what they would do in the fight as it stands, so
// that nobody need wait for them: none running, or one that failed, has.
export const haveBotsAnswered = (): boolean => running === null || running.failed || running.answered === running.seq

// a moment between one thing played and the next press, so each reads on its own
const BEAT_MS = 150

// How long an answer waits before it is pressed: until the board on this
// screen has played what it was given, and a beat after. Only a press waits,
// and not a throw of the dice a call waits on, which plays nothing.
function waitFor(answer: BotAnswer): number {
  const { step } = answer
  if (step.do !== 'press' || step.move.commands.every((c) => c.kind === 'answer')) return 0
  const { until } = usePlaybackStore.getState()
  return until > 0 ? Math.max(0, until + BEAT_MS - performance.now()) : 0
}

// `press` presses an answer and says whether its first press was made; `fail`
// is told why the thread could not decide, or not start and so is `over`.
export function startBots(press: (answer: BotAnswer) => boolean, fail: (why: string, over: boolean) => void): Bots {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const me: Running = { seq: 0, answered: 0, failed: false }
  running = me
  let fight: SceneState | null = null
  let table: string | null = null
  let restored: number | null = null
  const post = (message: ToBots) => worker.postMessage(message)

  worker.onmessage = ({ data }: MessageEvent<FromBots>) => {
    if (data.seq !== me.seq) return
    me.answered = data.seq
    if ('error' in data) return fail(data.error, false)
    // an answer waits for the board to play what came before it, and is
    // dropped if the fight changes meanwhile, as one that comes late is
    const take = () => {
      if (data.seq !== me.seq || running !== me) return
      const wait = waitFor(data)
      if (wait > 0) return void setTimeout(take, wait)
      if (data.memories) useBotMemoryStore.getState().patch(data.memories)
      const { seq } = data
      let played = false
      post({ kind: 'taken', seq })
      try { played = press(data) }
      finally { post({ kind: 'done', seq, played }) }
    }
    take()
  }
  worker.onerror = (event) => {
    me.failed = true
    fail(event.message || 'their thread could not be started', true)
  }

  return {
    tell: (scene, next) => {
      const now = sharedSceneOf(scene)
      const changed = fight ? diff(fight, now) : null
      const asTold = JSON.stringify(next)
      const memory = useBotMemoryStore.getState()
      if (fight && !changed && asTold === table && restored === memory.restored) return
      post({
        kind: 'tell',
        seq: ++me.seq,
        ...(!fight ? { fight: now } : changed ? { patch: changed } : {}),
        ...(asTold !== table ? { table: next } : {}),
        ...(restored !== memory.restored ? { memories: memory.memories } : {}),
      })
      fight = now
      table = asTold
      restored = memory.restored
    },
    stop: () => {
      worker.terminate()
      if (running === me) running = null
    },
  }
}
