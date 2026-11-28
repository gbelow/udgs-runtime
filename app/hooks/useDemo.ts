import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useAppStore } from "../stores/useAppStore";
import { getInPlay, useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { dropFight, keepFight, readFight, useFight, useKeptFight } from "../stores/useKeptFight";
import { useBotLogStore } from "../stores/useBotLogStore";
import { useDemoStore } from "../stores/useDemoStore";
import { makeKeptParts, makeWriter, readAutosave, readBotMemories, writeAutosave, writeBotMemories } from "../stores/autosave";
import { useBotMemoryStore } from "../stores/useBotMemoryStore";
import { DEMO, DEMO_SCENE, DEMO_VISITOR, DemoPlaySchema } from "../domain/demo";
import { getScenePreset } from "../domain/campaign/rules/scenes";
import { getBaseCharacters } from "../domain/character/grouping";
import { getSceneMaterials } from "../domain/scene/projections/prepared";
import { getDemoPicker, getDemoView } from "../domain/scene/projections/demo";
import { addDemoPick, fillDemoSides, playDemo, playDemoSide, removeDemoPick } from "../domain/scene/commands/demo";
import type { DemoSide } from "../domain/demo";
import { useSceneDispatch } from "./useSceneDispatch";
import { ExplorationStateSchema } from "../domain/exploration/types";
import { DowntimeStateSchema } from "../domain/downtime/types";
import { makeCampaignCharacter } from "../domain/factories";
import { CampaignSaveSchema, fromCampaignSave, newFile, readFallen, readGround, toFileInfo, toStoredCampaign } from "../domain/saves";

// The demo's scene, as the catalog has it.
const preset = () => getScenePreset(DEMO.scene);

// Making up the scene's parties: what is offered and picked for each, who
// plays it, and the presses that change them; joining makes the fight and
// opens it.
export function useDemoPicker(offered: readonly string[] | null) {
  const characters = useAppStore((s) => s.baseCharacterList);
  const boardMaps = useAppStore((s) => s.boardMaps);
  const stored = useDemoStore((s) => s.sides);
  const setSides = useDemoStore((s) => s.setSides);
  const view = useMemo(() => getDemoPicker(preset(), getBaseCharacters(characters), offered, stored), [characters, offered, stored]);
  const sides = (): DemoSide[] => view.sides.map((s) => ({ picks: s.picks.map((p) => p.key), you: s.you }));
  const join = useJoin();
  return {
    view,
    add: (at: number, key: string) => setSides(addDemoPick(sides(), at, key)),
    remove: (at: number, n: number) => setSides(removeDemoPick(sides(), at, n)),
    play: (at: number, you: boolean) => setSides(playDemoSide(sides(), at, you)),
    preselect: () => setSides(fillDemoSides(preset(), sides())),
    join: () => { if (view.joinBar === null) join(sides(), characters, boardMaps); },
  };
}

// The fight made from the parties made up and put on the screen: the
// campaign that lends its characters, who plays whom (the visitor, or the
// bot), the visitor's first character picked, and the demo at its placing;
// one who plays none of them watches the whole fight.
function useJoin() {
  const play = useDemoStore((s) => s.play);
  return (sides: DemoSide[], characters: Record<string, unknown>, boardMaps: Parameters<typeof getSceneMaterials>[1]) => {
    const scene = preset();
    const keys = [...new Set(sides.flatMap((s) => s.picks))];
    const { board, sheets } = getSceneMaterials({ board: scene.board, keys }, boardMaps, characters);
    const made = playDemo(scene, sides, board, sheets, () => crypto.randomUUID());
    if (!made) { toast.error('The demo scene cannot be played.'); return; }
    useBotLogStore.setState({ entries: [], paused: false, open: true });
    useBotMemoryStore.getState().restore();
    useCampaignStore.getState().openCampaign(
      { campaign: made.table.campaign, exploration: ExplorationStateSchema.parse({}), downtime: DowntimeStateSchema.parse({}), fight: made.table.fight },
      newFile(crypto.randomUUID(), { [DEMO_VISITOR]: 'player' }),
      made.owners,
    );
    const ids = Object.keys(made.table.fight.characters);
    keepFight(made.table.fight, DEMO_VISITOR, made.party === null);
    useCombatStore.setState({ activeCharacterId: ids.find((id) => made.table.fight.partyOf[id] === made.party) ?? null });
    useDemoStore.getState().setSides(sides);
    play(made.party ?? '');
  };
}

// The demo while it is played: the view of the fight the visitor reads (how it
// stands in full, for who won it), whether they only watch it, and their
// presses outside the fight's own (pick a character, place the rest of their
// party, start the fight, play the same parties again, make up others).
export function useDemo() {
  const party = useDemoStore((s) => s.party);
  const started = useDemoStore((s) => s.started);
  const sides = useDemoStore((s) => s.sides);
  const seen = useDemoStore((s) => s.seen);
  const fight = useFight((s) => s);
  const characters = useAppStore((s) => s.baseCharacterList);
  const boardMaps = useAppStore((s) => s.boardMaps);
  const activeId = useCombatStore((s) => s.activeCharacterId);
  const view = useMemo(() => getDemoView(fight, party || null, started, seen), [fight, party, started, seen]);
  const join = useJoin();
  const dispatch = useSceneDispatch();
  return {
    view,
    watching: party === '',
    activeId,
    pick: (id: string) => useCombatStore.getState().setActiveCharacter(id),
    placeRest: () => { if (party) dispatch({ kind: 'placeParty', args: [party] }); },
    start: () => { if (view.startBar === null) useDemoStore.getState().start(); },
    again: () => join(sides, characters, boardMaps),
    back: () => useDemoStore.getState().back(),
    seeHint: useDemoStore.getState().seeHint,
  };
}

// What of the demo kept apart from its save this browser holds.
const demoKept = makeKeptParts();

// The demo as this browser keeps it: the fight whole, and how the visitor is
// playing it.
async function writeDemo() {
  if (useKeptFight.getState().scene === null) return;
  const { file, owners } = useCampaignStore.getState();
  const demo = DemoPlaySchema.parse(useDemoStore.getState());
  const t = { ...getInPlay(), fight: readFight() };
  const { save, characters } = toStoredCampaign(file, t, owners);
  await writeAutosave(DEMO_VISITOR, DEMO_SCENE, { save, characters, at: Date.now(), demo, fallen: demoKept.fallen(DEMO_SCENE, t), ground: demoKept.ground(DEMO_SCENE, t) });
  demoKept.mark(DEMO_SCENE, t);
}

// The demo brought back as it was left; nothing where none was kept, or what
// was kept no longer reads.
async function resumeDemo(isLeft: () => boolean) {
  const [kept, memories] = await Promise.all([readAutosave(DEMO_VISITOR, DEMO_SCENE), readBotMemories(DEMO_VISITOR, DEMO_SCENE)]);
  const demo = DemoPlaySchema.safeParse(kept?.demo);
  const save = CampaignSaveSchema.safeParse(kept?.save);
  if (!kept || !demo.success || !save.success || isLeft() || useKeptFight.getState().scene !== null) return;
  if (Object.keys(save.data.fight.characters).length === 0) return;
  const t = fromCampaignSave(save.data, kept.characters.map(makeCampaignCharacter), readFallen(kept.fallen, kept.save), readGround(kept.ground));
  useBotLogStore.setState({ entries: [], paused: false, open: true });
  useBotMemoryStore.getState().restore(memories);
  useCampaignStore.getState().openCampaign(t, toFileInfo(save.data), save.data.owners);
  keepFight(t.fight, DEMO_VISITOR, demo.data.party === '');
  useCombatStore.setState({ activeCharacterId: Object.keys(t.fight.characters).find((id) => t.fight.partyOf[id] === demo.data.party) ?? null });
  useDemoStore.setState(demo.data);
}

// The demo brought back as this browser kept it, kept after every change, and
// its fight let go of as the page is left.
export function useDemoKept() {
  useEffect(() => {
    let left = false;
    const writer = makeWriter(writeDemo);
    const offFight = useKeptFight.subscribe(writer.ask);
    const offDemo = useDemoStore.subscribe(writer.ask);
    const memoryWriter = makeWriter(() => writeBotMemories(DEMO_VISITOR, DEMO_SCENE, useBotMemoryStore.getState().memories).then(() => undefined));
    const offMemory = useBotMemoryStore.subscribe((s, before) => { if (s.restored === before.restored) memoryWriter.ask(); });
    resumeDemo(() => left).catch((err) => console.error('Resuming the demo failed:', err));
    return () => {
      left = true;
      offFight();
      offDemo();
      offMemory();
      dropFight();
    };
  }, []);
}

// Whether the visitor is picking or playing, and whether they started the
// fight, without reading the fight itself.
export function useDemoStage() {
  const stage = useDemoStore((s) => s.stage);
  const started = useDemoStore((s) => s.started);
  return { stage, started, scene: preset().name, back: () => useDemoStore.getState().back() };
}
