import { getFocusBar, getTargetRows, type TargetRow } from "../domain/scene/projections/focus";
import { getSceneCards, getSceneCardsDigest, type SceneCardParty } from "../domain/scene/projections/cards";
import type { SceneState, SeenScene } from "../domain/scene/types";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { useSightStore } from "../stores/useSightStore";
import { useTableStore } from "../stores/useTableStore";
import { readSeenBoard } from "./useBoard";
import { useLookAt } from "./useBoardCanvas";
import { useCombatRoster } from "./useCombatState";
import { useRollerCheck } from "./useControl";
import { useSceneDispatch } from "./useSceneDispatch";

// The characters the screen plays, as a test of each id.
function useOwn(): (state: SceneState) => string[] {
  const rolls = useRollerCheck();
  useCampaignStore((s) => s.owners);
  useTableStore((s) => s.guests);
  return (state) => Object.keys(state.characters).filter((id) => rolls(id).own);
}

// The characters the screen plays, by party, while none of them holds the
// turn and the action in play waits on none of them (`getFocusBar`), else
// null; a click picks one, as the roster does, and the board looks at them.
export function useOwnChips(): { parties: SceneCardParty[] | null; pick: (card: SceneCardParty["cards"][number]) => void } {
  const own = useOwn();
  const shown = useCombatStore((s) => getFocusBar(s, own(s)).chips);
  useCombatStore(getSceneCardsDigest);
  const { pick } = useCombatRoster();
  const look = useLookAt();
  const fight = useCombatStore.getState();
  const mine = own(fight);
  const parties = shown
    ? getSceneCards(fight).map((p) => ({ ...p, cards: p.cards.filter((c) => mine.includes(c.id)) })).filter((p) => p.cards.length > 0)
    : null;
  return { parties, pick: (card) => { pick(card); look(card.id); } };
}

// On the turn of one of the screen's characters with no action open, or one
// of theirs aiming what they declare, whom the one it looks through perceives
// on the board (`getTargetRows`), else null; a click has the board look at
// them, and aims the open action at one it could be aimed at.
export function useTargetRows(): { rows: TargetRow[] | null; pick: (row: TargetRow) => void } {
  const own = useOwn();
  const sight = useSightStore();
  const read = (s: SeenScene): TargetRow[] | null => {
    if (!getFocusBar(s, own(s)).targets) return null;
    const { state, seen } = readSeenBoard(s, sight);
    return seen.present ? getTargetRows(seen, state.partyOf, state.activeCharacterId) : null;
  };
  const digest = useCombatStore((s) => JSON.stringify(read(s)));
  const look = useLookAt();
  const dispatch = useSceneDispatch();
  return {
    rows: JSON.parse(digest) as TargetRow[] | null,
    pick: (row) => { if (row.aim) dispatch({ kind: "target", args: [row.id] }); look(row.id); },
  };
}
