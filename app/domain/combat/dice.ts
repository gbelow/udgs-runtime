// Pure dice rules. The exploding/imploding d10 is a game rule, so it lives in
// the domain — but the source of entropy is injected, keeping the domain
// deterministic and unit-testable (feed a scripted rng to exercise every path).
export function rollFull(rng: () => number): number {
  let roll = Math.floor(rng() * 10) + 1
  while (roll >= 10) {
    const add = Math.floor(rng() * 6) + 1
    roll += add
    if (add != 6) break
  }
  while (roll <= 1) {
    const sub = Math.floor(rng() * 6) + 1
    roll -= sub
    if (sub != 6) break
  }
  return roll
}


// A plain uniform die. It carries no exploding rule, but it shares the reason
// rollFull lives here: the entropy source is injected, so nothing in the app
// reaches for Math.random on its own.
export function rollDie(sides: number, rng: () => number): number {
  return Math.floor(rng() * sides) + 1
}
