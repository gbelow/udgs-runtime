// gear.tex "Equipment Breakage": the chance an object breaks under one blow.
// A blow harder than twice RES breaks it outright; one that reaches RES in
// both blunt and cut breaks it half the time, in either alone one time in
// six. Only what can be cut breaks (the attacker harder than the object), and
// "Breakage and Hardness": a blow from hardness 1 or 2 puts nothing at risk.
export type BreakingBlow = { blunt: number; cut: number; hardness: number }
export type Breakable = { RES: number; hardness: number }

export function getBreakChance(blow: BreakingBlow, target: Breakable): number {
  if (blow.hardness <= 2 || blow.hardness <= target.hardness) return 0
  if (Math.max(blow.blunt, blow.cut) >= 2 * target.RES) return 1
  const reaching = [blow.blunt, blow.cut].filter((d) => d >= target.RES).length
  return reaching === 2 ? 1 / 2 : reaching === 1 ? 1 / 6 : 0
}
