import { getEndRoundView, type EndRoundView } from "../domain/scene/projections/turn";
import { useCombatStore } from "../stores/useCombatStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useTableStore } from "../stores/useTableStore";
import { useRollerCheck } from "./useControl";
import { useSceneDispatch } from "./useSceneDispatch";

// Agreeing to end the round for every character the screen answers for: a
// player's own, or the GM's and those of players who are not at the table.
export function useEndRound(): { view: EndRoundView; agree: (agree: boolean) => void } {
  const rolls = useRollerCheck();
  const dispatch = useSceneDispatch();
  useCampaignStore((s) => s.owners);
  useTableStore((s) => s.guests);
  const own = (characters: object) => Object.keys(characters).filter((id) => rolls(id).own);
  useCombatStore((s) => JSON.stringify(getEndRoundView(s, own(s.characters))));
  const fight = useCombatStore.getState();
  const agree = (agree: boolean) => {
    const ids = own(useCombatStore.getState().characters);
    if (ids.length > 0) dispatch({ kind: "agreeAllToEnd", args: [ids, agree] });
  };
  return { view: getEndRoundView(fight, own(fight.characters)), agree } as const;
}
