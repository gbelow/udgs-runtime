'use client'
import { memo, Profiler, ProfilerOnRenderCallback, useState } from "react";
import { PlayPanel } from "./PlayPanel";
import { useCombatStore } from "../stores/useCombatStore";
import { useAppStore } from "../stores/useAppStore";
import { makeCampaignCharacter } from "../domain/factories";
import { skillLenses } from "../domain/character/lenses";
import { measureProjection, measureProjectionBatch, ProjectionTiming, projectionEntries, ProjectionEntry } from "../perf";
import { CampaignCharacter, Character } from "../domain/types";
import { useActiveCharacterSelector } from "../hooks/useActiveCharacterSelector";

// Every registered lens/getter, flattened into one probe grid. This is the full
// read surface — a probe per controllable derived value, not just skills.
const PROBE_ENTRIES = projectionEntries();
const SETTABLE_TARGETS = PROBE_ENTRIES.filter((e) => e.set);

// Render-probe state. A probe re-renders iff its subscription fired; we record
// *which* entry rendered in a Set, so dev StrictMode's double-render dedups to
// one (the count is identical in dev and prod — no more 2x confusion). After
// the commit we compare each rendered entry's value before/after the mutation:
// an entry that re-rendered without its derived value changing is an "offender"
// — a selector-isolation failure. An entry whose value actually changed (the
// target, or a dependent) is a legit re-render, not flagged.
const probeState = {
  measuring: false,
  rendered: new Set<string>(),
  before: null as Map<string, unknown> | null,
  target: "",
};

// The probe reads through the SAME gated selector the production lens hooks
// use (useActiveCharacterSelector), so it reflects the isolated read path —
// not a whole-character subscription. A hook that selects lens.get(c) inside
// the store should not re-render its probe on unrelated mutations.
const RenderProbe = memo(function RenderProbe({ entry }: { entry: ProjectionEntry }) {
  // Side effect in render is intentional — this component exists to be counted.
  const value = useActiveCharacterSelector((c: Character) => entry.get(c));
  if (probeState.measuring) probeState.rendered.add(entry.name);
  return (
    <span className="text-xs px-1 py-0.5 border rounded min-w-6 text-center">
      {value === null || value === undefined ? "—" : String(value)}
    </span>
  );
});

export function BreakMe() {

  const [numPanels, setNumPanels] = useState(1)
  const [loadCount, setLoadCount] = useState(10)
  const loadCharacter = useCombatStore((state) => state.loadCharacter)
  const hasActiveCharacter = useCombatStore((s) => !!s.activeCharacterId)
  const baseCharacterList = useAppStore((s) => s.baseCharacterList)

  const [throughput, setThroughput] = useState<ProjectionTiming | null>(null)
  const [scaling, setScaling] = useState<{ chars: number; totalMs: number; usPerChar: number } | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  const [probe, setProbe] = useState<{
    target: string
    rendered: number
    of: number
    offenders: string[]
    panelMs: number
    numPanelsAtRun: number
  } | null>(null)
  const [probeTarget, setProbeTarget] = useState("skill.strike")

  const loadRandomCharacters = (n: number) => {
    // baseCharacterList is a flat { name: character } record, so its values
    // are the characters directly — no nested folders to flatten through.
    const randomChars = Object.values(baseCharacterList)
      .filter(el => el !== null && typeof el === 'object')

    for(let i = 0; i < n; i++){
      const randomChar = randomChars[Math.floor(Math.random() * randomChars.length)]
      if(randomChar) loadCharacter(randomChar)
    }
  }

  // --- Metric runners ------------------------------------------------------

  // One full projection of the active character (or an empty default).
  // Shows the per-read cost of "derived, never stored": every lens, every time.
  const runThroughput = () => {
    const active = useCombatStore.getState().getActiveCharacter() ?? makeCampaignCharacter({})
    setThroughput(measureProjection(active, 2000))
  }

  // One full projection across every loaded character. Add more characters
  // (10/50/200) and re-run — the cost should scale linearly.
  const runScaling = () => {
    const chars = Object.values(useCombatStore.getState().characters)
    setScaling(measureProjectionBatch(chars))
  }

  // Mutation + subscriber notify. updateActiveCharacter() runs the updater and
  // then Zustand's set(), which synchronously re-runs every subscriber's
  // selector before returning. React's render/commit is deferred, so this
  // window captures the updater plus the *entire* selector fan-out — which is
  // why it scales with numPanels (each PlayPanel holds several combat-store
  // subscriptions). It is not a React-free floor; it is the synchronous cost
  // of "one mutation, everyone notified."
  const runLatency = () => {
    const store = useCombatStore.getState()
    const before = store.getActiveCharacter()
    if (!before) { setLatency(null); return }
    const lens = skillLenses.strike
    const t0 = performance.now()
    store.updateActiveCharacter((c) => lens.set(c, lens.get(c)) as CampaignCharacter)
    const t1 = performance.now()
    setLatency((t1 - t0) * 1000) // µs
  }

  // Mount one probe per registered lens/getter, mutate a single settable value,
  // and flag every probe that re-rendered *without its value changing*. The
  // honest answer to "does a one-field change re-render the whole sheet?"
  const runProbe = () => {
    const store = useCombatStore.getState()
    const active = store.getActiveCharacter()
    if (!active) { setProbe(null); return }
    const entry = PROBE_ENTRIES.find((e) => e.name === probeTarget && e.set)
    if (!entry || !entry.set) return
    // Snapshot every entry's current value BEFORE the mutation, so after the
    // commit we can separate legit re-renders (value changed) from offenders.
    const before = new Map<string, unknown>()
    for (const e of PROBE_ENTRIES) before.set(e.name, e.get(active))
    probeState.measuring = true
    probeState.rendered = new Set()
    probeState.before = before
    probeState.target = entry.name
    store.updateActiveCharacter((c) => {
      const cur = entry.get(c)
      // Increment numbers, toggle booleans — a real value change either way.
      return entry.set!(c, typeof cur === "number" ? cur + 1 : !cur) as CampaignCharacter
    })
  }

  // Finalize on the PlayPanel commit: by the time this fires, the probe grid's
  // render-phase side effects have populated probeState.rendered. PlayPanels
  // subscribe to the whole character, so they always re-render on a mutation —
  // this callback is a reliable commit sentinel.
  const onPanelsRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
    if (!probeState.measuring) return
    probeState.measuring = false
    const active = useCombatStore.getState().getActiveCharacter()
    const byName = new Map(PROBE_ENTRIES.map((e) => [e.name, e]))
    const offenders: string[] = []
    for (const name of probeState.rendered) {
      const e = byName.get(name)
      if (!e || !active || !probeState.before) continue
      // Re-rendered, but the derived value is unchanged -> isolation failure.
      if (Object.is(probeState.before.get(name), e.get(active))) offenders.push(name)
    }
    offenders.sort()
    setProbe({
      target: probeState.target,
      rendered: probeState.rendered.size,
      of: PROBE_ENTRIES.length,
      offenders,
      panelMs: actualDuration,
      numPanelsAtRun: numPanels,
    })
  }

  return(
    <div className="py-2 flex flex-col gap-3">
      <div className="flex flex-row flex-wrap gap-2 items-center">
        <input type={'button'} className='hover:bg-gray-500 p-1 font-bold border rounded' value={'Load Random Characters'} aria-label={'random_char'} onClick={() => loadRandomCharacters(loadCount)}/>
        <label className="text-xs flex items-center gap-1">
          count
          <input type={'number'} className='text-center hover:bg-gray-500 p-1 w-16 border rounded' value={loadCount} aria-label={'load_count'} onChange={(e) => setLoadCount(parseInt(e.target.value) || 1)}/>
        </label>
        <label className="text-xs flex items-center gap-1 ml-auto">
          Panels
          <input type={'number'} className='text-center hover:bg-gray-500 p-1 w-16 border rounded' value={numPanels} aria-label={'add_panel'} onChange={(e) => setNumPanels(parseInt(e.target.value) || 1)}/>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        <MetricCard
          title="Projection throughput"
          hint="Cost to recompute every derived value for one character, from scratch."
          runLabel="Run"
          onRun={runThroughput}
        >
          {throughput ? (
            <div className="flex flex-col">
              <span>{throughput.usPerChar.toFixed(2)} µs / character</span>
              <span>{throughput.opsPerMs.toFixed(0)} ops/ms ({throughput.count} lenses)</span>
              <span className="text-gray-500">{throughput.iterations} iters, {throughput.totalMs.toFixed(2)} ms</span>
            </div>
          ) : <span className="text-gray-500">—</span>}
        </MetricCard>

        <MetricCard
          title="Scaling curve"
          hint="One projection pass over every loaded character. Should stay linear."
          runLabel="Run"
          onRun={runScaling}
        >
          {scaling ? (
            scaling.chars ? (
              <div className="flex flex-col">
                <span>{scaling.chars} characters</span>
                <span>{scaling.totalMs.toFixed(3)} ms total</span>
                <span>{scaling.usPerChar.toFixed(2)} µs / character</span>
              </div>
            ) : <span className="text-gray-500">load characters first</span>
          ) : <span className="text-gray-500">—</span>}
        </MetricCard>

        <MetricCard
          title="Mutation + subscriber notify"
          hint="updateActiveCharacter: runs the updater, then Zustand re-runs every subscriber's selector inline. Scales with numPanels. Excludes React render/commit."
          runLabel="Run"
          onRun={runLatency}
          disabled={!hasActiveCharacter}
        >
          {latency != null ? (
            <div className="flex flex-col">
              <span>{latency.toFixed(2)} µs</span>
              <span className="text-gray-500">update + fan-out</span>
            </div>
          ) : hasActiveCharacter ? <span className="text-gray-500">—</span> : <span className="text-gray-500">no active character</span>}
        </MetricCard>

        <MetricCard
          title="Re-render probe"
          hint={`Mutate one settable value, count how many of ${PROBE_ENTRIES.length} registered probes re-render. Offenders re-rendered without their value changing.`}
          runLabel="Mutate"
          onRun={runProbe}
          disabled={!hasActiveCharacter}
        >
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1">
              target
              <select
                className="text-center border rounded p-1 max-w-40"
                value={probeTarget}
                onChange={(e) => setProbeTarget(e.target.value)}
              >
                {SETTABLE_TARGETS.map((e) => (
                  <option key={e.name} value={e.name}>{e.name}</option>
                ))}
              </select>
            </label>
            {probe ? (
              <div className="flex flex-col">
                <span>{probe.rendered} / {probe.of} probes re-rendered</span>
                <span>{probe.offenders.length} offender{probe.offenders.length === 1 ? "" : "s"} (value unchanged)</span>
                {probe.offenders.length > 0 && (
                  <span className="text-gray-500 break-words">{probe.offenders.join(", ")}</span>
                )}
                <span>PlayPanel commit: {probe.panelMs.toFixed(3)} ms ({probe.numPanelsAtRun} panel{probe.numPanelsAtRun === 1 ? "" : "s"})</span>
              </div>
            ) : hasActiveCharacter ? <span className="text-gray-500">—</span> : <span className="text-gray-500">no active character</span>}
          </div>
        </MetricCard>
      </div>

      {/* The probe grid stays mounted so its subscriptions are live. */}
      <div className="border rounded p-2">
        <div className="text-xs text-gray-500 mb-1">Re-render probes (one per registered lens/getter):</div>
        <div className="flex flex-wrap gap-1">
          {PROBE_ENTRIES.map((e) => <RenderProbe key={e.name} entry={e} />)}
        </div>
      </div>

      <Profiler id="panels" onRender={onPanelsRender}>
        {new Array(numPanels).fill(0).map((_, i) => (
          <PlayPanel key={i} />
        ))}
      </Profiler>
    </div>
  )
}

function MetricCard({
  title,
  hint,
  runLabel,
  onRun,
  disabled,
  children,
}: {
  title: string;
  hint: string;
  runLabel: string;
  onRun: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded p-2 flex flex-col gap-1 text-xs">
      <div className="font-bold">{title}</div>
      <div className="text-gray-500">{hint}</div>
      <div className="min-h-10 py-1">{children}</div>
      <input
        type="button"
        className="border rounded p-1 hover:bg-gray-500 disabled:opacity-40 disabled:hover:bg-transparent mt-auto"
        value={runLabel}
        onClick={onRun}
        disabled={disabled}
      />
    </div>
  );
}
