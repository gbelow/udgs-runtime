// The shades a resource's gauge is drawn in, its levels lowest first (a
// gauge's `level` picks one; globals.css holds the colours): AP amber, STA
// green, IL red. The board and the screens read this one table.
export const GAUGE_SHADES = {
  AP: ['ap-0', 'ap-1', 'ap-2'],
  STA: ['sta-0', 'sta-1', 'sta-2'],
  IL: ['il-1', 'il-2', 'il-3', 'il-4', 'il-5'],
} as const

export type GaugeKey = keyof typeof GAUGE_SHADES
export type GaugeShade = (typeof GAUGE_SHADES)[GaugeKey][number]

// The shade as a background class, written out whole so that Tailwind finds it.
export const SHADE_BG: Record<GaugeShade, string> = {
  'ap-0': 'bg-ap-0', 'ap-1': 'bg-ap-1', 'ap-2': 'bg-ap-2',
  'sta-0': 'bg-sta-0', 'sta-1': 'bg-sta-1', 'sta-2': 'bg-sta-2',
  'il-1': 'bg-il-1', 'il-2': 'bg-il-2', 'il-3': 'bg-il-3', 'il-4': 'bg-il-4', 'il-5': 'bg-il-5',
}

export const shadeOf = (key: GaugeKey, level: number): GaugeShade => GAUGE_SHADES[key][Math.min(level, GAUGE_SHADES[key].length - 1)]
