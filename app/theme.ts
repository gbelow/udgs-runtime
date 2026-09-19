// Palettes are defined in globals.css; this only picks which one <html> is
// stamped with. Set NEXT_PUBLIC_THEME in .env to switch; umber is the default.
export const THEMES = ['umber', 'frost', 'ember'] as const
export type Theme = (typeof THEMES)[number]

const isTheme = (value: string | undefined): value is Theme =>
  (THEMES as readonly string[]).includes(value ?? '')

const requested = process.env.NEXT_PUBLIC_THEME
export const THEME: Theme = isTheme(requested) ? requested : 'umber'
