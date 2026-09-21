import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchBoard, publishBoard } from "../actions";
import { importBoard } from "../domain/combat/commands/board";
import { isSnapshot, toSnapshot } from "../vtt/snapshot";
import { useCombatStore } from "../stores/useCombatStore";

// The board's link to a VTT through the mailbox, and the same board as text
// for a clipboard. `push` publishes the fight's board; `pull` reads the
// mailbox and imports what is there when it is news — a snapshot the app
// itself wrote, or one already seen, is left alone. Auto-pull polls while
// on. All of it is convenience around two server actions and one command.
export function useVttLink() {
  const update = useCombatStore((s) => s.updateCombatState);
  const [fight, setFight] = useState('');
  const [auto, setAuto] = useState(false);
  const seen = useRef<number>(0);

  const snapshot = () => {
    const state = useCombatStore.getState();
    return state.board ? toSnapshot(state, state.board) : null;
  };

  const push = async () => {
    const snap = snapshot();
    if (!snap || !fight) return;
    const res = await publishBoard(fight, snap);
    if (!res.ok) { toast.error(res.error); return; }
    seen.current = snap.updatedAt;
    toast.success('Board published.');
  };

  const pull = async (quiet = false) => {
    if (!fight) return;
    const res = await fetchBoard(fight);
    if (!res.ok) { if (!quiet) toast.error(res.error); return; }
    const raw = res.data;
    if (!isSnapshot(raw)) { if (!quiet) toast.error('Nothing in the mailbox yet.'); return; }
    const at = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0;
    if (raw.source === 'app' || at <= seen.current) { if (!quiet) toast('Nothing new.'); return; }
    seen.current = at;
    update(importBoard(raw.board));
    if (!quiet) toast.success('Board pulled.');
  };

  useEffect(() => {
    if (!auto || !fight) return;
    const timer = setInterval(() => { void pull(true); }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, fight]);

  const copy = async () => {
    const snap = snapshot();
    if (!snap) return;
    await navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
    toast.success('Board copied.');
  };

  const paste = async () => {
    try {
      const raw: unknown = JSON.parse(await navigator.clipboard.readText());
      update(importBoard(isSnapshot(raw) ? raw.board : raw));
      toast.success('Board imported.');
    } catch {
      toast.error('Clipboard does not hold a board.');
    }
  };

  return { fight, setFight, auto, setAuto, push, pull: () => pull(false), copy, paste } as const;
}
