import { z } from 'zod'
import demoConfig from '../assets/demo.json'
import type { BotId } from './profiles'

// The demo on the home page: a prepared scene of the catalog (`scene`, by
// key), whose party marked for the visitor they fill from a collection of
// catalog characters (`collection`, by id; none offers the whole character
// catalog) and play against the bots, who play every other party.
export const DemoConfigSchema = z.object({
  scene: z.string().catch(''),
  collection: z.string().catch(''),
})
export type DemoConfig = z.infer<typeof DemoConfigSchema>

export const DEMO: DemoConfig = DemoConfigSchema.parse(demoConfig)

// Whom the visitor plays as: a profile of nobody's, never saved.
export const DEMO_VISITOR = 'demo:visitor'

// The bot that plays every party but the visitor's (the user's ruling,
// 2026-11-23).
export const DEMO_BOT: BotId = 'bot:threat'

// The id the demo's scene is played under, which its fight parties and cast
// are named from.
export const DEMO_SCENE = 'demo'
