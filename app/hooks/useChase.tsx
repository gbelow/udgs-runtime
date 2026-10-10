import { getChaseDigest, getChasePanel, type ChasePanel } from "../domain/scene/projections/chase";
import { chooseChaseWay, chooseStance, endChase as endTheChase, followGroup, joinFight, runChase, setChaseCover, setGroupFighting, startChase as beginChase, turnAround as turnAroundOf } from "../domain/scene/commands/chase";
import { getChaseStartBar, type ChaseWay } from "../domain/scene/rules/chase";
import type { ChaseCover, ChaseTier, SkirmishStance } from "../domain/lists";
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
    run: (group: string) => updateCombatState(runChase(group, realDice)),
    choose: (group: string, way: ChaseWay) => updateCombatState(chooseChaseWay(group, way)),
    follow: (partyId: string, group: string) => updateCombatState(followGroup(partyId, group)),
    setFighting: (group: string, fighting: boolean) => updateCombatState(setGroupFighting(group, fighting)),
    join: (partyId: string, to: string) => updateCombatState(joinFight(partyId, to)),
    endChase: () => updateCombatState(endTheChase),
    turnAround: (id: string) => updateCombatState(turnAroundOf(id)),
    chooseStance: (partyId: string, stance: SkirmishStance) => updateCombatState(chooseStance(partyId, stance)),
    setCover: (id: string, cover: ChaseCover | null) => updateCombatState(setChaseCover(id, cover)),
  };
}
