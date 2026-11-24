import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from '../factories'
import type { CampaignCharacter } from '../types'
import { getPair, readPair, type PairAttack } from './pairs'

// The pair table is kept by what it says it reads of each sheet, so what it
// leaves out may change without the table: a pair asked for once something
// left out has changed is the one kept before it did, and must be what
// reading it afresh gives.

const CATALOG = path.join(process.cwd(), 'app/assets/characters')
const sheets = readdirSync(CATALOG).filter((f) => f.endsWith('.json')).map((f) => makeCampaignCharacter(JSON.parse(readFileSync(path.join(CATALOG, f), 'utf-8'))))

const trained = (c: CampaignCharacter, keys: readonly string[]): CampaignCharacter =>
  ({ ...c, trainables: Object.fromEntries(Object.entries(c.trainables).map(([key, t]) => [key, keys.includes(key) ? { ...t, value: t.value + 7, XP: t.XP + 1 } : t])) as CampaignCharacter['trainables'] })

const spent = (c: CampaignCharacter): CampaignCharacter =>
  JSON.parse(JSON.stringify(c), function (this: { type?: unknown }, key, v) { return key === 'amount' && this.type === 'ammo' ? v + 3 : v })

const UNREAD = Object.entries(sheets[0].trainables).filter(([, t]) => t.type === 'skill' || t.type === 'knowledge').map(([key]) => key)
const hurt = (c: CampaignCharacter): CampaignCharacter => ({ ...c, injuries: { ...c.injuries, bleed: 2, scorch: 3, potion: 1, staunched: true } })

// Both sheets changed in everything their role leaves out.
const READ = ['force', 'detection', 'prestidigitation']
const changed: Record<'attacker' | 'defender', (c: CampaignCharacter) => CampaignCharacter> = {
  attacker: (c) => spent(hurt(trained({ ...c, injuries: { ...c.injuries, burning: 4 } }, UNREAD.filter((k) => ![...READ, 'strike', 'accuracy'].includes(k))))),
  defender: (c) => spent(hurt(trained(c, UNREAD.filter((k) => ![...READ, 'defend', 'reflex', 'SD'].includes(k))))),
}

// A pair with every hit read out, so that two are compared whole.
const whole = (pair: PairAttack[]): string => JSON.stringify(pair, (_, v) => (v && typeof v.at === 'function' && typeof v.count === 'number' ? Array.from({ length: v.count }, (_, i) => v.at(i)) : v))

describe('the pair table', () => {
  it.each(sheets.map((c, i) => [c.name, i] as const))('%s: what it leaves out of a sheet changes nothing it holds', (_, i) => {
    const attacker = { ...sheets[i], id: 'attacker' }
    const defender = { ...sheets[(i + 1) % sheets.length], id: 'defender' }
    const a = changed.attacker(attacker)
    const d = changed.defender(defender)
    const kept = getPair(attacker, defender, null)
    expect(getPair(a, d, null)).toBe(kept)
    // under another name nothing is read off the harm the pair kept
    expect(whole(readPair({ ...a, name: 'read afresh' }, { ...d, name: 'read afresh' }))).toBe(whole(kept))
  })
})
