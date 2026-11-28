import { z } from 'zod'
import defaults from './assets/keys/default.json'

// Every command the keyboard (and the right mouse button) presses, with what
// it is called, and the keys each is pressed by in a key profile. The default
// profile is a file (assets/keys/default.json); a profile of a player's own
// would name only the commands it binds otherwise. A key is named as
// `KeyboardEvent.key` names it, but for `Space` and the right button
// (`RightClick`).

export const KEY_COMMANDS = {
  'card.back': 'back a step',
  'card.next': 'go on',
  'card.commit': 'commit',
  'card.cancel': 'cancel',
  'card.tile1': 'tile 1',
  'card.tile2': 'tile 2',
  'card.tile3': 'tile 3',
  'card.tile4': 'tile 4',
  'card.tile5': 'tile 5',
  'card.tile6': 'tile 6',
  'card.tile7': 'tile 7',
  'card.tile8': 'tile 8',
  'card.tile9': 'tile 9',
  'bots.pause': 'pause the bots',
} as const

export type KeyCommand = keyof typeof KEY_COMMANDS

export const TILE_COMMANDS = ['card.tile1', 'card.tile2', 'card.tile3', 'card.tile4', 'card.tile5', 'card.tile6', 'card.tile7', 'card.tile8', 'card.tile9'] as const satisfies readonly KeyCommand[]

const COMMANDS = Object.keys(KEY_COMMANDS) as [KeyCommand, ...KeyCommand[]]

export const KeyProfileSchema = z.partialRecord(z.enum(COMMANDS), z.array(z.string().max(32)).max(4))

export type KeyMap = Record<KeyCommand, readonly string[]>

export const DEFAULT_KEYS: KeyMap = KeyProfileSchema.parse(defaults) as KeyMap

// The keys as a profile binds them, every command it leaves out on its default.
export function getKeyMap(profile: z.infer<typeof KeyProfileSchema> = {}): KeyMap {
  return { ...DEFAULT_KEYS, ...profile } as KeyMap
}

const RIGHT_CLICK = 'RightClick'

const nameOf = (e: KeyboardEvent | MouseEvent): string => (e instanceof MouseEvent ? (e.button === 2 ? RIGHT_CLICK : '') : e.key === ' ' ? 'Space' : e.key)

// Whether the key or the click presses the command.
export function isKey(map: KeyMap, command: KeyCommand, e: KeyboardEvent | MouseEvent): boolean {
  const name = nameOf(e)
  return name !== '' && map[command].includes(name)
}

// The command a key or a click presses, of those asked about.
export function findKey<C extends KeyCommand>(map: KeyMap, commands: readonly C[], e: KeyboardEvent | MouseEvent): C | null {
  return commands.find((c) => isKey(map, c, e)) ?? null
}

const SHOWN: Record<string, string> = { Escape: 'Esc', [RIGHT_CLICK]: 'right click', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }

// The first key the command is pressed by, as a hint beside it says it.
export function keyLabel(map: KeyMap, command: KeyCommand): string {
  const key = map[command][0]
  return key === undefined ? '' : SHOWN[key] ?? key
}
