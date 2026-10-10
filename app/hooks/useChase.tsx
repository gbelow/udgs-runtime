import { getChaseDigest, getChasePanel, type ChasePanel } from "../domain/scene/projections/chase";
import { chooseChaseWay, chooseStance, endChase as endTheChase, runChase, setChaseCover, startChase as beginChase, turnAround as turnAroundOf } from "../domain/scene/commands/chase";
import { getChaseStartBar, type ChaseWay } from "../domain/scene/rules/chase";
import type { ChaseCover, ChaseSide, ChaseTier, SkirmishStance } from "../domain/lists";
import { useCombatStore } from "../stores/useCombatStore";
import { realDice } from "../components/utils";

// combat.tex "Chases" — the chase panel, gated on a digest since it is
// freshly allocated, and why the parties picked cannot set off at the tier
// picked.
export function useChase(quarry: string[], tier: ChaseTier): ChasePanel & { startBar: string | null } {
  useCombatStore(getChaseDigest);
  const startBar = useCombatStore((s) => getChaseStartBar(s, quarry, tier));
  return { ...getChasePanel(useCombatStore.getState()), startBar };
}

export function useChaseCommands() {
  const updateCombatState = useCombatStore((s) => s.updateCombatState);
  return {
    startChase: (quarry: string[], tier: ChaseTier) => updateCombatState(beginChase(quarry, tier)),
    run: () => updateCombatState(runChase(realDice)),
    choose: (way: ChaseWay) => updateCombatState(chooseChaseWay(way)),
    endChase: () => updateCombatState(endTheChase),
    turnAround: (id: string) => updateCombatState(turnAroundOf(id)),
    chooseStance: (side: ChaseSide, stance: SkirmishStance) => updateCombatState(chooseStance(side, stance)),
    setCover: (id: string, cover: ChaseCover | null) => updateCombatState(setChaseCover(id, cover)),
  };
}
