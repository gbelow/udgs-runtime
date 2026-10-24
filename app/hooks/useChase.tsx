import { getChaseDigest, getChasePanel, type ChasePanel } from "../domain/scene/projections/chase";
import { getChaseStartBar } from "../domain/scene/rules/chase";
import type { ChaseDeclaration } from "../domain/scene/types";
import type { ChaseCover, ChaseTier, CrossingSkill } from "../domain/lists";
import { useCombatStore } from "../stores/useCombatStore";
import { useSceneDispatch } from "./useSceneDispatch";

// combat.tex "Chases" — the chase panel, gated on a digest since it is
// freshly allocated, and why the parties picked cannot set off at the tier
// picked.
export function useChase(quarry: string[], tier: ChaseTier): ChasePanel & { startBar: string | null } {
  useCombatStore(getChaseDigest);
  const startBar = useCombatStore((s) => getChaseStartBar(s, quarry, tier));
  return { ...getChasePanel(useCombatStore.getState()), startBar };
}

export function useChaseCommands() {
  const dispatch = useSceneDispatch();
  return {
    startChase: (quarry: string[], tier: ChaseTier) => dispatch({ kind: "startChase", args: [quarry, tier] }),
    declare: (partyId: string, declaration: ChaseDeclaration) => dispatch({ kind: "declareChase", args: [partyId, declaration] }),
    confirm: (partyId: string) => dispatch({ kind: "confirmChase", args: [partyId] }),
    resolve: () => dispatch({ kind: "resolveChase", args: [] }),
    follow: (partyId: string, target: string) => dispatch({ kind: "followParty", args: [partyId, target] }),
    putBack: (partyId: string, target: string, tier: ChaseTier) => dispatch({ kind: "putBack", args: [partyId, target, tier] }),
    giveUp: (partyId: string) => dispatch({ kind: "giveUp", args: [partyId] }),
    mergeBack: (partyId: string) => dispatch({ kind: "mergeBack", args: [partyId] }),
    setFighting: (partyId: string, fighting: boolean) => dispatch({ kind: "setPartyFighting", args: [partyId, fighting] }),
    join: (partyId: string, to: string) => dispatch({ kind: "joinChaseFight", args: [partyId, to] }),
    cross: (partyId: string, skill: CrossingSkill, DL: number) => dispatch({ kind: "crossObstacle", args: [partyId, skill, DL] }),
    endChase: () => dispatch({ kind: "endChase", args: [] }),
    turnAround: (id: string) => dispatch({ kind: "turnAround", args: [id] }),
    setCover: (id: string, cover: ChaseCover | null) => dispatch({ kind: "setChaseCover", args: [id, cover] }),
  };
}
