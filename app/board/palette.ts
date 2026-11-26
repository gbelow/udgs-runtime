// The theme's colours as the board's canvas takes them: the semantic tokens of
// app/globals.css, read off the page so that a theme drawn with CSS draws the
// board the same way.
import { GAUGE_SHADES } from '../gaugeShades'

export const TOKENS = ['bg', 'surface', 'raised', 'line', 'fg', 'muted', 'accent', 'good', 'caution', 'bad', 'injury-2', ...GAUGE_SHADES.AP, ...GAUGE_SHADES.STA, ...GAUGE_SHADES.IL] as const

export type Token = (typeof TOKENS)[number]
export type Palette = Record<Token, number>

const FALLBACK: Palette = {
  bg: 0x0a0806, surface: 0x14100c, raised: 0x1e1812, line: 0x35291d, fg: 0xeadfcb,
  muted: 0x93826a, accent: 0xd1934f, good: 0x5cb87a, caution: 0xd9b44a, bad: 0xdc4c4c, 'injury-2': 0xd8823f,
  'ap-0': 0x94703a, 'ap-1': 0xc49640, 'ap-2': 0xf5bc45,
  'sta-0': 0x4e7a5d, 'sta-1': 0x46a36b, 'sta-2': 0x58dc8d,
  'il-1': 0xec8a82, 'il-2': 0xe2635c, 'il-3': 0xcf403b, 'il-4': 0xa1242a, 'il-5': 0x6a1418,
}

// A colour CSS can say, as a number: drawn on a pixel and read back, so that
// any form a theme writes its tokens in is understood.
function toNumber(css: string, probe: CanvasRenderingContext2D): number | null {
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#000000'
  probe.fillStyle = css
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
  return a === 0 ? null : (r << 16) | (g << 8) | b
}

export function readPalette(): Palette {
  if (typeof document === 'undefined') return FALLBACK
  const style = getComputedStyle(document.documentElement)
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!probe) return FALLBACK
  return Object.fromEntries(TOKENS.map((t) => {
    const css = style.getPropertyValue(`--${t}`).trim()
    return [t, (css ? toNumber(css, probe) : null) ?? FALLBACK[t]]
  })) as Palette
}
