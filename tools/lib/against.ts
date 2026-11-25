import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Box } from '../../app/domain/bot/decision'

// A box as another version of the code plays it: a commit's, kept under
// node_modules/.cache (where its own imports still find the packages), or
// whatever folder holds an `app/domain` and an `app/assets`. Only the box is
// the other version's: the table it plays at is this one's, so the two must
// agree on the shape of a fight.

export type Version = { name: string; root: string }

export function getVersion(of: string): Version {
  if (existsSync(of) && statSync(of).isDirectory()) return { name: path.basename(of), root: path.resolve(of) }
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf-8' }).trim()
  const sha = git('rev-parse', '--verify', `${of}^{commit}`)
  const name = git('rev-parse', '--short', sha)
  const root = path.join(process.cwd(), 'node_modules', '.cache', 'arena', sha)
  if (!existsSync(root)) {
    const made = `${root}.${process.pid}`
    mkdirSync(made, { recursive: true })
    git('archive', '--format=tar', '-o', path.join(made, 'code.tar'), sha, 'app/domain', 'app/assets', 'tsconfig.json')
    execFileSync('tar', ['-xf', 'code.tar'], { cwd: made })
    rmSync(path.join(made, 'code.tar'))
    renameSync(made, root)
  }
  return { name, root }
}

// What that version keeps of the fights it has read, forgotten (bot/forget.ts),
// where it has that.
export async function loadForget({ root }: Version): Promise<() => void> {
  const file = path.join(root, 'app', 'domain', 'bot', 'forget.ts')
  if (!existsSync(file)) return () => {}
  const loaded = await import(pathToFileURL(file).href)
  return (loaded.forgetFight ? loaded : loaded.default).forgetFight
}

// `boxes/<name>.ts` of that version, on its own weights with `set` over them.
export async function loadBox({ root }: Version, name: string, set: Partial<Record<string, number>>): Promise<() => Box> {
  const loaded = await import(pathToFileURL(path.join(root, 'app', 'domain', 'bot', 'boxes', `${name}.ts`)).href)
  const held = loaded[`${name}Box`] ? loaded : loaded.default
  const weights = held[`${name.toUpperCase()}_WEIGHTS`]
  return () => (weights ? held[`${name}Box`]({ ...weights, ...set }) : held[`${name}Box`])
}
