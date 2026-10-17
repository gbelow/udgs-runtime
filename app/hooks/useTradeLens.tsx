import { getTradeView, TradeView } from "../domain/item/projections/trade";
import { Character } from "../domain/types";
import { useAppStore } from "../stores/useAppStore";
import { useActiveCharacterDerived, useActiveInventoryUpdate } from "./useActiveCharacterSelector";

// Trading with a merchant: stacks are put down from the container panel, what
// is bought is picked in the item sidebar and placed in a slot group as a cart
// line, and the panel counts it all. The trade is UI state until it is made.
export function useTradeLens() {
  const update = useActiveInventoryUpdate();
  const trade = useAppStore((s) => s.trade);
  const setTrade = useAppStore((s) => s.setTrade);

  const view: TradeView | null =
    useActiveCharacterDerived((c: Character) => (trade ? getTradeView(c, trade) : null), JSON.stringify) ?? null;

  const start = () => setTrade({ offered: [], cart: [] });
  const cancel = () => setTrade(null);

  const isOffered = (itemId: string) => trade?.offered.includes(itemId) ?? false;

  const toggleOffer = (itemId: string) => {
    if (!trade) return;
    setTrade({ ...trade, offered: isOffered(itemId) ? trade.offered.filter((id) => id !== itemId) : [...trade.offered, itemId] });
  };

  const removeLine = (index: number) => {
    if (trade) setTrade({ ...trade, cart: trade.cart.filter((_, i) => i !== index) });
  };

  const confirm = () => {
    if (!trade || !view?.able) return;
    update({ kind: 'trade', args: [trade] });
    setTrade(null);
  };

  return { trading: trade !== null, view, start, cancel, isOffered, toggleOffer, removeLine, confirm } as const;
}
