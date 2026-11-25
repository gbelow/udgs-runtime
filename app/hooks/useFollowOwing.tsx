import { useEffect, useRef } from "react";
import { getOwing, getOwingPick } from "../domain/scene/projections/turn";
import { getFightName } from "../domain/scene/rules/fighters";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { readFight, useFight } from "../stores/useKeptFight";
import { useTableStore } from "../stores/useTableStore";
import { useRollerCheck } from "./useControl";

// Whenever what the action being played out waits on one of the screen's own
// for changes, the screen picks them (`getOwingPick`), and whoever was picked
// before once it waits on none of theirs, unless another was picked since.
// Which of theirs it waits on now, and picking them.
export function useFollowOwing(): { waiting: { id: string; name: string } | null; pick: () => void } {
  const rolls = useRollerCheck();
  useCampaignStore((s) => s.owners);
  useTableStore((s) => s.guests);
  const owing = useFight((s) => getOwing(s).filter((id) => rolls(id).own).join());
  const moved = useRef<{ from: string | null; to: string } | null>(null);
  useEffect(() => {
    const { activeCharacterId: picked, setActiveCharacter } = useCombatStore.getState();
    const fight = readFight();
    if (owing === "") {
      const back = moved.current;
      moved.current = null;
      if (back === null || back.from === null || picked !== back.to || picked === fight.inTurnCharacter || !fight.characters[back.from]) return;
      setActiveCharacter(back.from);
      return;
    }
    const next = getOwingPick(fight, owing.split(","), picked);
    if (next === null || next === picked) return;
    moved.current = { from: moved.current ? moved.current.from : picked, to: next };
    setActiveCharacter(next);
  }, [owing]);
  const id = owing === "" ? null : owing.split(",")[0];
  const name = useFight((s) => (id === null ? "" : getFightName(s, id)));
  return {
    waiting: id === null ? null : { id, name },
    pick: () => { if (id !== null) useCombatStore.getState().setActiveCharacter(id); },
  };
}
