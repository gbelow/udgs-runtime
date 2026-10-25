import type { Coord, LightLevel } from "../domain/scene/types";
import { EXPLOSION_DRAFT, EXPLOSION_EFFECTS, IMPOSE_AFFLICTIONS, IMPOSE_DAMAGE_KINDS, type ExplosionDraft } from "../domain/scene/rules/impose";
import type { TerrainBrush } from "../domain/types";
import { BoardView, getBoardView, getBoardViewDigest, getBoardViewFrom, getBoardViewFromDigest, getResizeWarning } from "../domain/scene/projections/boardView";
import { readClick, type Click } from "../domain/scene/commands/click";
import { useCombatStore } from "../stores/useCombatStore";
import { useAppStore } from "../stores/useAppStore";
import { useFloorToolStore } from "../stores/useFloorToolStore";
import { useGmPickStore } from "../stores/useGmPickStore";
import { useSceneDispatch } from "./useSceneDispatch";
import { usePendingItem } from "./useItemLens";
import { useState } from "react";

// The board as drawn, and the clicks on it. Gated on a digest of the view,
// like the action panel. What a click means, and whom it acts for, is the
// domain's to say (`readClick`): a click that picks a character is this
// screen's alone, and any other is sent as a scene command with whom the
// screen has picked.
const NONE: string[] = [];

export function useBoard(fromActive = false) {
  useCombatStore(fromActive ? getBoardViewFromDigest : getBoardViewDigest);
  const view: BoardView = (fromActive ? getBoardViewFrom : getBoardView)(useCombatStore.getState());
  const setActiveCharacter = useCombatStore((s) => s.setActiveCharacter);
  const dispatch = useSceneDispatch();

  const create = (radius: number) => dispatch({ kind: "createBoard", args: [radius] });
  const remove = () => dispatch({ kind: "removeBoard", args: [] });
  const click = (c: Click, brush: TerrainBrush | null = null, reposition = false) => {
    const state = useCombatStore.getState();
    const selected = state.activeCharacterId;
    const read = readClick(state, c, { brush, reposition, selected, newId: () => "" });
    if ("select" in read) setActiveCharacter(read.select);
    else dispatch({ kind: "click", args: [c, brush, reposition, selected] });
  };

  const clickCell = (cell: Coord, brush: TerrainBrush | null, reposition: boolean) => click({ on: 'cell', cell }, brush, reposition);
  const clickToken = (id: string) => {
    if (useGmPickStore.getState().picking) useGmPickStore.getState().toggle(id);
    else click({ on: 'token', id });
  };
  const clickFloorItem = (itemId: string) => click({ on: 'floor', itemId });
  const picked = useGmPickStore((s) => (s.picking ? s.picked : NONE));
  const place = (id: string) => setActiveCharacter(id);
  const { floorTool, setFloorTool, explosion, setExplosion, explosionOptions, item } = useGmFloorTools();
  const placeItem = (cell: Coord) => { if (item) dispatch({ kind: "placeItem", args: [item, cell] }); };
  const removeFloorItem = (itemId: string) => dispatch({ kind: "removeFloorItem", args: [itemId] });
  const setOffExplosion = (draft: ExplosionDraft, cell: Coord) => dispatch({ kind: "setOffExplosion", args: [draft, cell] });
  const chargeByGM = (itemId: string) => dispatch({ kind: "chargeByGM", args: [itemId, explosion] });
  const setOffItem = (itemId: string) => dispatch({ kind: "setOffItem", args: [itemId] });
  const turn = (reposition: boolean) => click({ on: 'turn' }, null, reposition);
  const light = (level: LightLevel) => dispatch({ kind: "light", args: [level] });
  const resize = (radius: number) => dispatch({ kind: "resizeBoard", args: [radius] });
  const resizeWarning = (radius: number) => getResizeWarning(useCombatStore.getState(), radius);

  return { view, item, create, remove, clickCell, clickToken, clickFloorItem, place, placeItem, removeFloorItem, setOffExplosion, chargeByGM, setOffItem, picked, floorTool, setFloorTool, explosion, setExplosion, explosionOptions, turn, light, resize, resizeWarning } as const;
}

// The GM's floor tool and the explosion it carries, shared by the buttons that
// pick them and the board that is clicked.
export function useGmFloorTools() {
  const floorTool = useFloorToolStore((s) => s.floorTool);
  const setFloorTool = useFloorToolStore((s) => s.setFloorTool);
  const explosion = useFloorToolStore((s) => s.explosion);
  const setExplosion = useFloorToolStore((s) => s.setExplosion);
  const explosionOptions = { effects: EXPLOSION_EFFECTS, damageKinds: IMPOSE_DAMAGE_KINDS, afflictions: IMPOSE_AFFLICTIONS } as const;
  const pending = useAppStore((s) => s.pendingItem);
  const pendingItem = usePendingItem();
  const item = pending?.source === "catalog" ? pendingItem : null;
  return { floorTool, setFloorTool, explosion, setExplosion, explosionOptions, item } as const;
}

// What the GM has described of an explosion, for the form that writes it.
export function useExplosionDraft() {
  const [explosion, setExplosion] = useState<ExplosionDraft>(EXPLOSION_DRAFT);
  const explosionOptions = { effects: EXPLOSION_EFFECTS, damageKinds: IMPOSE_DAMAGE_KINDS, afflictions: IMPOSE_AFFLICTIONS } as const;
  return { explosion, setExplosion, explosionOptions } as const;
}

export type ExplosionDraftState = ReturnType<typeof useExplosionDraft>;
