import { Attributes, Character } from "../../types"
import { ATTRIBUTE_KEYS, getAttributeRaisePrice, getExpectedAttributeSizeBalance } from "../rules/learning"
import { getSize } from "../rules/size"

export type AttributeLevelUpView = {
  // the next point of each attribute, its XP price, null at the cap
  rows: { key: keyof Attributes; value: number; next: number | null }[]
  size: number
  // 10-SM at that size
  expectedBalance: number
}

// creating.tex "Improving attributes": what the next point of each attribute
// costs, and the balance the book expects at the creature's size.
export function getAttributeLevelUp(c: Character): AttributeLevelUpView {
  return {
    rows: ATTRIBUTE_KEYS.map((key) => ({ key, value: c.trainables[key].value, next: getAttributeRaisePrice(key)(c)?.amount ?? null })),
    size: getSize(c),
    expectedBalance: getExpectedAttributeSizeBalance(c),
  }
}
