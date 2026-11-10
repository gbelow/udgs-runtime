import { Assets, Texture } from 'pixi.js'
import { assetUrl } from './assetUrl'

// The pictures the board is drawn with, each loaded once and kept for every
// board after: a surface, a wall face, a structure, a token. A picture still
// loading is drawn without, and whoever asked is told once it has come.
type Entry = { texture: Texture | null; failed: boolean; waiting: Set<() => void> }

const cache = new Map<string, Entry>()

export function getTexture(src: string, onLoad: () => void): Texture | null {
  if (!src) return null
  const known = cache.get(src)
  if (known) {
    if (!known.texture && !known.failed) known.waiting.add(onLoad)
    return known.texture
  }
  const entry: Entry = { texture: null, failed: false, waiting: new Set([onLoad]) }
  cache.set(src, entry)
  Assets.load<Texture>({ src: assetUrl(src), parser: 'texture' }).then((texture) => {
    texture.source.style.addressMode = 'repeat'
    texture.source.style.mipmapFilter = 'linear'
    texture.source.style.update()
    texture.source.autoGenerateMipmaps = true
    texture.source.updateMipmaps()
    entry.texture = texture
  }, () => {
    entry.failed = true
  }).finally(() => {
    const waiting = [...entry.waiting]
    entry.waiting.clear()
    waiting.forEach((tell) => tell())
  })
  return null
}

// Whether a picture could not be loaded at all.
export function hasFailed(src: string): boolean {
  return cache.get(src)?.failed ?? false
}
