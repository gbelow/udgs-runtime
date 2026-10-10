import { Character } from '../../types'
import { isBaseCharacter } from '../../utils'
import { getCoins, getKeptWealth } from '../rules/money'
import { seatCoins } from './money'

// creating.tex "Character Creation", Step 3: the gold the gear did not use is
// lost, but for the tenth that may be spared, which is kept as coins together
// with the coins already carried. The budget is spent for good, so it is gone.
export function settleStartingWealth<C extends Character>(c: C): C {
  if (!isBaseCharacter(c) || c.startingWealth === null) return c
  const stocked = getCoins(getKeptWealth(c)).reduce<C>(seatCoins, c)
  return { ...stocked, startingWealth: null }
}
