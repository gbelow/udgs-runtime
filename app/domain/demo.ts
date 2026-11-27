import { z } from 'zod'
import demoConfig from '../assets/demo.json'
import type { BotId } from './profiles'

// The demo on the home page: a prepared scene of the catalog (`scene`, by
// key), each of whose parties (one for each spawn area) the visitor fills
// from a collection of catalog characters (`collection`, the id of one for
// everyone; none offers the whole character catalog). They play one of them
// against the bots, who play every other, or watch the bots play them all.
export const DemoConfigSchema = z.object({
  scene: z.string().catch(''),
  collection: z.string().catch(''),
})
export type DemoConfig = z.infer<typeof DemoConfigSchema>

export const DEMO: DemoConfig = DemoConfigSchema.parse(demoConfig)

// Whom the visitor plays as: a profile of nobody's, never saved.
export const DEMO_VISITOR = 'demo:visitor'

// The bot that plays whoever the scene gives to none, the visitor's party
// aside (the user's ruling, 2026-11-25).
export const DEMO_BOT: BotId = 'bot:spec'

// The id the demo's scene is played under, which its fight parties and cast
// are named from.
export const DEMO_SCENE = 'demo'

// What the visitor is told when it first comes up: an action of theirs being
// declared, one waiting on their answer, the round waiting on them, a turn
// one of theirs may start.
export const DEMO_HINTS = ['action', 'answer', 'round', 'turn'] as const
export type DemoHint = (typeof DEMO_HINTS)[number]

// The most characters a party of the demo takes, and the most in its fight
// (the user's ruling, 2026-11-27).
export const DEMO_PARTY_MOST = 12
export const DEMO_FIGHT_MOST = 24

// One of the demo scene's parties as the visitor makes it up: the catalog
// characters in it, by key, and whether the visitor plays it or the bot does.
export const DemoSideSchema = z.object({
  picks: z.array(z.string()),
  you: z.boolean(),
})
export type DemoSide = z.infer<typeof DemoSideSchema>

// How the visitor is playing the demo: the scene's parties as they made them
// up (one for each of the scene's, in its order; none yet for the scene's own
// line-up), whether they are picking or playing, the fight party that is
// theirs (none while they watch), whether they said the fight may begin, and
// the hints they have put away.
export const DemoPlaySchema = z.object({
  stage: z.enum(['pick', 'play']),
  sides: z.array(DemoSideSchema),
  party: z.string(),
  started: z.boolean(),
  seen: z.array(z.enum(DEMO_HINTS)).catch([]),
})
export type DemoPlay = z.infer<typeof DemoPlaySchema>
