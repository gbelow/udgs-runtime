// A party's name: the first "Party n" none of these parties has.
export function nextPartyName(parties: Record<string, { name: string }>): string {
  const names = new Set(Object.values(parties).map((p) => p.name))
  let n = 1
  while (names.has(`Party ${n}`)) n++
  return `Party ${n}`
}
