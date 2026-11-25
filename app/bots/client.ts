import { diff } from '../net/diff'
import { sharedSceneOf } from '../net/protocol'
import type { SceneState } from '../domain/scene/types'
import { useBotMemoryStore } from '../stores/useBotMemoryStore'
import type { BotAnswer, BotsTable, ToBots } from './player'
import type { FromBots } from './worker'

// The bots' thread as the screen that keeps the table holds it: told of the
// fight by what changed in it, numbered, and giving each answer that is still
// about the fight as it stands, to be pressed at once.
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
    if (data.memories) useBotMemoryStore.getState().patch(data.memories)
    const { seq } = data
    let played = false
    post({ kind: 'taken', seq })
    try { played = press(data) }
    finally { post({ kind: 'done', seq, played }) }
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
