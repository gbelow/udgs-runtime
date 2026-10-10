import { Character, Item } from '../../types'
import { isBaseCharacter } from '../../utils'
import { findCoinSeat, getCoins, getKeptWealth } from '../rules/money'
import { addItemToContainer } from './items'

function seat<C extends Character>(c: C, coins: Item): C {
  const at = findCoinSeat(c, coins)
  return at ? addItemToContainer(at.containerKey, at.slot, coins)(c) : c
}

// creating.tex "Character Creation", Step 3: the gold the gear did not use is
// lost, but for the tenth that may be spared, which is kept as coins together
// with the coins already carried. The budget is spent for good, so it is gone.
export function settleStartingWealth<C extends Character>(c: C): C {
  if (!isBaseCharacter(c) || c.startingWealth === null) return c
  const stocked = getCoins(getKeptWealth(c)).reduce<C>((acc, coins) => seat(acc, coins), c)
  return { ...stocked, startingWealth: null }
}
