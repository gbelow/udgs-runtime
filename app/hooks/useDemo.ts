import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useAppStore } from "../stores/useAppStore";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { dropFight, keepFight, useFight } from "../stores/useKeptFight";
import { useBotLogStore } from "../stores/useBotLogStore";
import { useDemoStore } from "../stores/useDemoStore";
import { DEMO, DEMO_VISITOR } from "../domain/demo";
import { getScenePreset } from "../domain/campaign/rules/scenes";
import { getBaseCharacters } from "../domain/character/grouping";
import { getSceneMaterials } from "../domain/scene/projections/prepared";
import { getDemoPicker, getDemoView } from "../domain/scene/projections/demo";
import { playDemo } from "../domain/scene/commands/demo";
import { ExplorationStateSchema } from "../domain/exploration/types";
import { DowntimeStateSchema } from "../domain/downtime/types";
import { newFile } from "../domain/saves";

// The demo's scene, as the catalog has it.
const preset = () => getScenePreset(DEMO.scene);

// Picking the visitor's party: what is offered and picked, and the presses
// that change it; joining makes the fight and opens it.
export function useDemoPicker(offered: readonly string[] | null) {
  const characters = useAppStore((s) => s.baseCharacterList);
  const boardMaps = useAppStore((s) => s.boardMaps);
  const picks = useDemoStore((s) => s.picks);
  const setPicks = useDemoStore((s) => s.setPicks);
  const view = useMemo(() => getDemoPicker(preset(), getBaseCharacters(characters), offered, picks), [characters, offered, picks]);
  const join = useJoin();
  return {
    view,
    add: (key: string) => { if (!view.full) setPicks([...view.picks.map((p) => p.key), key]); },
    remove: (at: number) => setPicks(view.picks.map((p) => p.key).filter((_, i) => i !== at)),
    preselect: () => setPicks(view.lineup),
    join: () => { if (view.joinBar === null) join(view.picks.map((p) => p.key), characters, boardMaps); },
  };
}

// The fight made from the picks and put on the screen: the campaign that
// lends its characters, who plays whom (the visitor, or the bot), the
// visitor's first character picked, and the demo at its placing.
function useJoin() {
  const play = useDemoStore((s) => s.play);
  return (picks: string[], characters: Record<string, unknown>, boardMaps: Parameters<typeof getSceneMaterials>[1]) => {
    const scene = preset();
    const keys = [...new Set([...picks, ...scene.parties.flatMap((p) => p.members.map((m) => m.key))])];
    const { board, sheets } = getSceneMaterials({ board: scene.board, keys }, boardMaps, characters);
    const made = playDemo(scene, picks, board, sheets, () => crypto.randomUUID());
    if (!made) { toast.error('The demo scene cannot be played.'); return; }
    useBotLogStore.setState({ entries: [], paused: false, open: true });
    useCampaignStore.getState().openCampaign(
      { campaign: made.table.campaign, exploration: ExplorationStateSchema.parse({}), downtime: DowntimeStateSchema.parse({}), fight: made.table.fight },
      newFile(crypto.randomUUID(), { [DEMO_VISITOR]: 'player' }),
      made.owners,
    );
    keepFight(made.table.fight, DEMO_VISITOR);
    useCombatStore.setState({ activeCharacterId: Object.keys(made.table.fight.characters).find((id) => made.table.fight.partyOf[id] === made.party) ?? null });
    play(made.party);
  };
}

// The demo while it is played: the view of the fight the visitor reads (how it
// stands in full, for who won it), and
// their presses outside the fight's own (pick a character of theirs, start
// the fight, play the same party again, pick another).
export function useDemo() {
  const party = useDemoStore((s) => s.party);
  const started = useDemoStore((s) => s.started);
  const picks = useDemoStore((s) => s.picks);
  const fight = useFight((s) => s);
  const characters = useAppStore((s) => s.baseCharacterList);
  const boardMaps = useAppStore((s) => s.boardMaps);
  const view = useMemo(() => getDemoView(fight, party, started), [fight, party, started]);
  const join = useJoin();
  return {
    view,
    pick: (id: string) => useCombatStore.getState().setActiveCharacter(id),
    start: () => { if (view.startBar === null) useDemoStore.getState().start(); },
    again: () => join(picks, characters, boardMaps),
    back: () => useDemoStore.getState().back(),
  };
}

// The demo's fight is let go of as the page is left.
export function useDemoEnd() {
  useEffect(() => dropFight, []);
}

// Whether the visitor is picking or playing, and whether they started the
// fight, without reading the fight itself.
export function useDemoStage() {
  const stage = useDemoStore((s) => s.stage);
  const started = useDemoStore((s) => s.started);
  return { stage, started, scene: preset().name, back: () => useDemoStore.getState().back() };
}
