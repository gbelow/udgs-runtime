import { getFightReport, type FightReportRow } from "../domain/scene/projections/report";
import { readFight, useFight } from "../stores/useKeptFight";

// What the fight came to for each who was in it, the whole of it wherever the
// screen keeps one; re-rendered only when something lands or is changed.
export function useFightReport(): FightReportRow[] {
  useFight((s) => `${s.landed.length}:${s.edits.length}:${Object.keys(s.names).length}`);
  return getFightReport(readFight());
}
