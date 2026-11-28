import { describe, expect, it } from 'vitest'
import defaults from './assets/keys/default.json'
import { DEFAULT_KEYS, KEY_COMMANDS, KeyProfileSchema, type KeyCommand } from './keys'

describe('the default key profile', () => {
  it('is a key profile as the schema reads one', () => {
    expect(KeyProfileSchema.safeParse(defaults).success).toBe(true)
  })

  it('binds every command to some key', () => {
    for (const command of Object.keys(KEY_COMMANDS) as KeyCommand[]) expect(DEFAULT_KEYS[command]?.length ?? 0, command).toBeGreaterThan(0)
  })
})
