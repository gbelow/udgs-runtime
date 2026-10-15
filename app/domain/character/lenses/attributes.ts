import { Attributes, Character } from "../../types"
import { ATTRIBUTE_KEYS, getAttributeBalanceTerms, getAttributeRaisePrice } from "../rules/learning"
import { Term, sumTerms } from "../rules/terms"

export type AttributeLevelUpView = {
  // the next point of each attribute, its XP price, null at the cap
  rows: { key: keyof Attributes; value: number; next: number | null }[]
  average: number
  balance: number
  balanceTerms: Term[]
  // whether the average is already past the balance, so every point costs more
  over: boolean
}

// creating.tex "Improving attributes": what the next point of each attribute
// costs and the balance whose passing doubles it.
export function getAttributeLevelUp(c: Character): AttributeLevelUpView {
  const rows = ATTRIBUTE_KEYS.map((key) => ({ key, value: c.trainables[key].value, next: getAttributeRaisePrice(key)(c)?.amount ?? null }))
  const average = sumTerms(rows.map((r) => ({ label: r.key, value: r.value }))) / rows.length
  const balanceTerms = getAttributeBalanceTerms(c)
  const balance = sumTerms(balanceTerms)
  return { rows, average, balance, balanceTerms, over: average > balance }
}
