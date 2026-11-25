import { forgetOpenWalks } from '../scene/rules/move'
import { forgetPairs } from './pairs'
import { forgetWalks } from './walks'

// What the bots keep of the fights they read (the pairs, the harm, the walks),
// forgotten, once a fight is over. It only spares reading the same again, so
// nothing decided turns on it.
export function forgetFight(): void {
  forgetPairs()
  forgetWalks()
  forgetOpenWalks()
}
