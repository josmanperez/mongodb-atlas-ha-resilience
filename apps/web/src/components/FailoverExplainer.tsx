import { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Play, Pause, Brain } from 'lucide-react';
import type { WorkloadType } from '@atlas-demo/shared';
import type { AtlasProcess } from '../hooks/useAtlas';

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeState = 'primary' | 'secondary' | 'stepping-down' | 'election' | 'new-primary';
type AppConn   = number | 'searching' | null;
type Accent    = 'green' | 'amber' | 'blue';

interface StepDef {
  phase:      string;
  title:      string;
  body:       string;
  bullet:     string;
  nodeStates: [NodeState, NodeState, NodeState];
  appConn:    AppConn;
  accent:     Accent;
}

interface Props {
  isRunning:      boolean;
  workloadType:   WorkloadType | null;
  readPref:       'primary' | 'secondaryPreferred';
  processes:      AtlasProcess[];
  recentFailover: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function shortHost(h: string): string {
  return h.match(/shard-\d{2}-\d{2}/i)?.[0] ?? h.split('.')[0]?.slice(-10) ?? '?';
}

function primaryIdx(procs: AtlasProcess[]): number {
  const i = procs.findIndex(p => p.typeName.includes('PRIMARY'));
  return i === -1 ? 1 : i;
}

// ── Step content ───────────────────────────────────────────────────────────────

function buildSteps(
  workloadType: WorkloadType | null,
  readPref: 'primary' | 'secondaryPreferred',
  procs: AtlasProcess[],
): StepDef[] {
  const pi        = primaryIdx(procs);
  const newPi     = (pi + 1) % 3;
  const secIdx    = [0, 1, 2].find(i => i !== pi) ?? 0;
  const labels    = procs.length >= 3
    ? procs.slice(0, 3).map(p => shortHost(p.hostname))
    : ['shard-00-00', 'shard-00-01', 'shard-00-02'];

  // Helper: build a 3-tuple with one role at index i, another everywhere else
  function trio(primary: NodeState, secondary: NodeState, overrideIdx?: number, overrideState?: NodeState): [NodeState, NodeState, NodeState] {
    const r = [secondary, secondary, secondary] as [NodeState, NodeState, NodeState];
    r[pi] = primary;
    if (overrideIdx !== undefined && overrideState !== undefined) r[overrideIdx] = overrideState;
    return r;
  }

  // ── Write / Update / Bulk ─────────────────────────────────────────────────
  if (workloadType === 'write' || workloadType === 'update' || workloadType === 'bulk') {
    return [
      {
        phase:      '1 of 4 · Steady State',
        title:      'Writes flowing with majority durability',
        body:       `Every ${workloadType} operation routes to ${labels[pi]} with w:"majority". The driver's streaming SDAM keeps topology state current within milliseconds — not polled every 10 s, but pushed on change. All ${procs.length} replica set members are monitored continuously.`,
        bullet:     'retryWrites: true — every operation wrapped automatically',
        nodeStates: trio('primary', 'secondary'),
        appConn:    pi,
        accent:     'green',
      },
      {
        phase:      '2 of 4 · Step-Down',
        title:      'Primary steps down — driver notified instantly',
        body:       `Atlas issues a graceful step-down to ${labels[pi]}. Via the streaming protocol the driver gets this topology event in milliseconds. Any write that was in-flight receives NotPrimaryError — retryWrites intercepts it before it ever surfaces to your application code.`,
        bullet:     'In-flight write queued for retry — no error thrown yet',
        nodeStates: trio('stepping-down', 'secondary'),
        appConn:    null,
        accent:     'amber',
      },
      {
        phase:      '3 of 4 · Election',
        title:      'Replica set elects a new primary',
        body:       `The remaining nodes campaign. The driver enters server selection, waiting up to 10 s for a primary to emerge. Atlas elections complete in 3–7 s. retryWrites holds the queued write until a winner is announced — never dropping it.`,
        bullet:     'Driver in server selection wait — serverSelectionTimeoutMS: 10 000',
        nodeStates: [
          pi === 0 ? 'secondary' : 'election',
          pi === 1 ? 'secondary' : 'election',
          pi === 2 ? 'secondary' : 'election',
        ],
        appConn:    'searching',
        accent:     'amber',
      },
      {
        phase:      '4 of 4 · Recovery',
        title:      'Zero data loss, zero client errors',
        body:       `${labels[newPi]} wins the election. The driver discovers it immediately via streaming SDAM and retries the queued write. Majority write concern guarantees durability — the write either already committed to 2+ nodes before the step-down, or the retry delivers it now. Client error count: 0.`,
        bullet:     'Retried write acknowledged — end-to-end errors: 0',
        nodeStates: trio('secondary', 'secondary', newPi, 'new-primary'),
        appConn:    newPi,
        accent:     'green',
      },
    ];
  }

  // ── Read · secondaryPreferred ─────────────────────────────────────────────
  if (readPref === 'secondaryPreferred') {
    return [
      {
        phase:      '1 of 4 · Steady State',
        title:      'Reads routed to secondaries — primary never touched',
        body:       `With secondaryPreferred, the driver routes reads to ${labels[secIdx]} (and load-balances across all available secondaries). The primary handles writes only. Your read path has zero dependency on which node is primary, or whether the primary is even reachable.`,
        bullet:     'Read target: secondary replica — primary irrelevant',
        nodeStates: trio('primary', 'secondary'),
        appConn:    secIdx,
        accent:     'blue',
      },
      {
        phase:      '2 of 4 · Primary Steps Down',
        title:      'Primary leaves — reads completely unaffected',
        body:       `Atlas steps down ${labels[pi]}. Your reads are already on secondaries — this event is invisible to the read workload. The driver does not re-select, does not retry, does not pause. Zero latency impact.`,
        bullet:     'Read path: unaffected — no re-selection required',
        nodeStates: trio('stepping-down', 'secondary'),
        appConn:    secIdx,
        accent:     'blue',
      },
      {
        phase:      '3 of 4 · Election Runs in Background',
        title:      'Reads continue while election happens',
        body:       `The replica set elects a new primary. This is a write-path event. Your reads keep flowing to secondaries throughout the entire election window. The "REPAIRING" cluster state in Atlas UI is cosmetic — your read workload is fully live.`,
        bullet:     'Reads/sec: unchanged throughout election window',
        nodeStates: [
          pi === 0 ? 'election' : 'secondary',
          pi === 1 ? 'election' : 'secondary',
          pi === 2 ? 'election' : 'secondary',
        ],
        appConn:    secIdx,
        accent:     'blue',
      },
      {
        phase:      '4 of 4 · True Zero-Impact HA',
        title:      'Reads never noticed — new primary takes over writes',
        body:       `${labels[newPi]} wins the election. Your reads were on secondaries the entire time — they remain there. This is the zero-downtime read architecture: your reads never touched the election at all. Total read errors during failover: 0. Total latency impact: 0.`,
        bullet:     'Total read errors during failover: 0',
        nodeStates: trio('secondary', 'secondary', newPi, 'new-primary'),
        appConn:    secIdx,
        accent:     'green',
      },
    ];
  }

  // ── Read · primary ────────────────────────────────────────────────────────
  return [
    {
      phase:      '1 of 4 · Steady State',
      title:      'Reads flowing to primary via streaming SDAM',
      body:       `All reads route to ${labels[pi]}. The driver holds a persistent monitoring socket to every replica set member — topology changes are pushed to the driver within milliseconds of occurring, not discovered on the next poll interval.`,
      bullet:     'retryReads: true — reads retry automatically on transient errors',
      nodeStates: trio('primary', 'secondary'),
      appConn:    pi,
      accent:     'green',
    },
    {
      phase:      '2 of 4 · Step-Down',
      title:      'Primary steps down — driver knows immediately',
      body:       `Atlas issues a graceful step-down to ${labels[pi]}. The streaming SDAM protocol pushes this topology event to the driver in milliseconds. Any in-flight read gets NotPrimaryError — retryReads intercepts it silently before your code sees it.`,
      bullet:     'Streaming SDAM: push notification, not 10-second poll',
      nodeStates: trio('stepping-down', 'secondary'),
      appConn:    null,
      accent:     'amber',
    },
    {
      phase:      '3 of 4 · Server Selection',
      title:      'Driver waits — it does NOT fail',
      body:       `The driver enters server selection, waiting up to 10 s for a new primary to appear. Atlas elections complete in 3–7 s. retryReads queues the retry. From your application's perspective, the read takes a bit longer on that one call — no exception is thrown.`,
      bullet:     'serverSelectionTimeoutMS: 10 000 ms — driver waits, not errors',
      nodeStates: [
        pi === 0 ? 'secondary' : 'election',
        pi === 1 ? 'secondary' : 'election',
        pi === 2 ? 'secondary' : 'election',
      ],
      appConn:    'searching',
      accent:     'amber',
    },
    {
      phase:      '4 of 4 · Recovery',
      title:      'Read resumes — error count still zero',
      body:       `${labels[newPi]} is elected. The driver discovers it instantly via streaming SDAM and routes the retried read to the new primary. Your application received elevated latency on one operation — it never received an error. The terminal shows only ✓ READ events throughout.`,
      bullet:     'End-to-end client errors: 0 — latency spike only',
      nodeStates: trio('secondary', 'secondary', newPi, 'new-primary'),
      appConn:    newPi,
      accent:     'green',
    },
  ];
}

// ── Node styles ────────────────────────────────────────────────────────────────

const NODE_RING: Record<NodeState, string> = {
  'primary':       'border-mdb-green/50 bg-mdb-green/[0.13] shadow-[0_0_14px_rgba(0,237,100,0.20)]',
  'secondary':     'border-white/[0.10]  bg-white/[0.03]',
  'stepping-down': 'border-amber-400/60  bg-amber-500/[0.10] animate-pulse',
  'election':      'border-amber-500/35  bg-amber-500/[0.06] animate-pulse',
  'new-primary':   'border-mdb-green/55 bg-mdb-green/[0.13] new-primary-flash shadow-[0_0_18px_rgba(0,237,100,0.26)]',
};

const NODE_DOT: Record<NodeState, string> = {
  'primary':       'bg-mdb-green',
  'secondary':     'bg-gray-700',
  'stepping-down': 'bg-amber-400',
  'election':      'bg-amber-500/70',
  'new-primary':   'bg-mdb-green',
};

const NODE_LABEL: Record<NodeState, string> = {
  'primary':       'PRIMARY',
  'secondary':     'SECONDARY',
  'stepping-down': 'STEP-DOWN',
  'election':      'CANDIDATE',
  'new-primary':   'NEW PRIMARY',
};

const NODE_TEXT: Record<NodeState, string> = {
  'primary':       'text-mdb-green',
  'secondary':     'text-gray-600',
  'stepping-down': 'text-amber-400',
  'election':      'text-amber-500/80',
  'new-primary':   'text-mdb-green',
};

const ACCENT = {
  green: { bar: 'bg-mdb-green',  text: 'text-mdb-green',  tint: 'bg-mdb-green/[0.07]',  border: 'border-mdb-green/20'  },
  amber: { bar: 'bg-amber-500',  text: 'text-amber-400',  tint: 'bg-amber-500/[0.07]',  border: 'border-amber-500/20'  },
  blue:  { bar: 'bg-blue-500',   text: 'text-blue-400',   tint: 'bg-blue-500/[0.07]',   border: 'border-blue-500/20'   },
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function FailoverExplainer({ isRunning, workloadType, readPref, processes, recentFailover }: Props) {
  const [open,     setOpen]     = useState(false);
  const [step,     setStep]     = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);

  const steps   = buildSteps(workloadType, readPref, processes);
  const current = steps[step] ?? steps[0];
  const ac      = ACCENT[current.accent];

  // Auto-advance
  useEffect(() => {
    if (!open || !autoPlay) return;
    const t = setInterval(() => setStep(s => (s + 1) % steps.length), 3000);
    return () => clearInterval(t);
  }, [open, autoPlay, steps.length]);

  // Reset on open
  useEffect(() => {
    if (open) { setStep(0); setAutoPlay(true); }
  }, [open]);

  const labels = processes.length >= 3
    ? processes.slice(0, 3).map(p => shortHost(p.hostname))
    : ['shard-00-00', 'shard-00-01', 'shard-00-02'];

  const show = isRunning || recentFailover;

  return (
    <>
      {/* ── Floating trigger ── */}
      <button
        onClick={() => setOpen(true)}
        disabled={!show}
        className={`fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold font-display border shadow-xl backdrop-blur-sm transition-all duration-300 active:scale-[0.97] ${
          show
            ? recentFailover
              ? 'bg-mdb-green/[0.15] border-mdb-green/50 text-mdb-green shadow-[0_0_24px_rgba(0,237,100,0.14)]'
              : 'bg-[#111116]/90 border-white/[0.13] text-gray-100 hover:border-white/[0.22] hover:text-white shadow-black/50'
            : 'bg-[#0c0c10]/60 border-white/[0.05] text-gray-700 cursor-not-allowed shadow-none'
        }`}
        title={!show ? 'Start a workload to activate' : 'Open HA Failover Explainer'}
      >
        <Brain className="w-3.5 h-3.5 shrink-0" />
        HA Explainer
        {recentFailover && (
          <span className="relative flex w-2 h-2">
            <span className="animate-ping absolute inset-0 rounded-full bg-mdb-green opacity-60" />
            <span className="relative rounded-full w-2 h-2 bg-mdb-green" />
          </span>
        )}
      </button>

      {/* ── Modal overlay ── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          {/* Ambient glow behind card */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className={`w-[600px] h-[400px] rounded-full blur-[120px] opacity-20 transition-colors duration-700 ${
              current.accent === 'green' ? 'bg-mdb-green' : current.accent === 'amber' ? 'bg-amber-400' : 'bg-blue-500'
            }`} />
          </div>

          {/* Glass card — wider, two-column body */}
          <div
            className="relative p-px rounded-2xl w-full max-w-[760px] bg-gradient-to-b from-white/[0.14] to-white/[0.03] ring-1 ring-white/[0.10] shadow-[0_40px_80px_rgba(0,0,0,0.80)]"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-[#0a0a0f] rounded-[calc(1rem-1px)] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">

              {/* Header */}
              <div className="flex items-center justify-between px-7 pt-5 pb-4 border-b border-white/[0.07]">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-mdb-green/[0.12] border border-mdb-green/30 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(0,237,100,0.12)]">
                    <Brain className="w-5 h-5 text-mdb-green" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold font-display text-white leading-tight tracking-tight">
                      Atlas HA — How Failovers Work
                    </h2>
                    <p className="text-xs text-gray-500 font-mono mt-0.5">
                      {workloadType ?? 'workload'} · {readPref === 'secondaryPreferred' ? 'secondary ✦' : 'primary'} reads
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-2 rounded-lg text-gray-600 hover:text-gray-200 hover:bg-white/[0.07] transition-all duration-150"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Progress tabs + phase label */}
              <div className="px-7 pt-4 pb-1 space-y-2">
                <div className="flex gap-1.5">
                  {steps.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => { setStep(i); setAutoPlay(false); }}
                      className={`flex-1 h-1 rounded-full transition-all duration-500 ${
                        i === step ? ac.bar : i < step ? 'bg-white/30' : 'bg-white/[0.08]'
                      }`}
                    />
                  ))}
                </div>
                <p className={`text-[11px] font-mono font-semibold uppercase tracking-[0.18em] ${ac.text}`}>
                  {current.phase}
                </p>
              </div>

              {/* ── Two-column body: topology left, text right ── */}
              <div className="flex gap-0 px-7 pb-2 pt-3">

                {/* Left — topology viz */}
                <div className="w-[300px] shrink-0">
                  <div className={`rounded-xl border ${ac.border} ${ac.tint} p-5 h-full flex flex-col justify-center transition-all duration-500`}>
                    <div className="flex items-end justify-center gap-4">
                      {([0, 1, 2] as const).map(i => {
                        const ns          = current.nodeStates[i];
                        const isTarget    = current.appConn === i;
                        const isSearching = current.appConn === 'searching';

                        return (
                          <div key={i} className="flex flex-col items-center gap-1.5">
                            {/* APP / APP? badge */}
                            <div className={`flex flex-col items-center transition-all duration-500 ${isTarget ? 'opacity-100' : 'opacity-0'}`}>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-400/30 text-blue-400 font-semibold">APP</span>
                              <div className="w-px h-4 bg-gradient-to-b from-blue-400/70 to-transparent" />
                            </div>
                            {isSearching && i === 1 && (
                              <div className="flex flex-col items-center animate-pulse">
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-400/30 text-amber-400 font-semibold">APP?</span>
                                <div className="w-px h-4 bg-amber-400/50" />
                              </div>
                            )}

                            {/* Node card */}
                            <div className={`w-[76px] rounded-xl border px-2 py-4 flex flex-col items-center gap-2.5 transition-all duration-500 ${NODE_RING[ns]}`}>
                              <div className={`w-3 h-3 rounded-full transition-colors duration-500 ${NODE_DOT[ns]}`} />
                              <p className={`text-[9px] font-mono font-bold uppercase leading-none tracking-wider text-center ${NODE_TEXT[ns]}`}>
                                {NODE_LABEL[ns]}
                              </p>
                            </div>

                            {/* Hostname */}
                            <p className="text-[9px] font-mono text-gray-600 truncate max-w-[86px] text-center">
                              {labels[i]}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div className="w-px mx-6 bg-white/[0.06] self-stretch" />

                {/* Right — step content */}
                <div className="flex-1 min-w-0 flex flex-col justify-between gap-4 py-1">
                  <div className="space-y-3">
                    <h3 className="text-[17px] font-semibold font-display text-white leading-snug tracking-tight">
                      {current.title}
                    </h3>
                    <p className="text-sm text-gray-400 leading-relaxed">
                      {current.body}
                    </p>
                  </div>
                  <div className={`flex items-start gap-3 px-4 py-3 rounded-xl ${ac.tint} border ${ac.border}`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${ac.bar}`} />
                    <span className={`text-xs font-mono leading-relaxed ${ac.text}`}>{current.bullet}</span>
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between px-7 py-4 border-t border-white/[0.06] mt-2">
                <button
                  onClick={() => { setStep(s => (s - 1 + steps.length) % steps.length); setAutoPlay(false); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-200 hover:bg-white/[0.06] transition-all duration-150"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Prev
                </button>

                <button
                  onClick={() => setAutoPlay(a => !a)}
                  className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium border transition-all duration-150 ${
                    autoPlay
                      ? 'bg-white/[0.08] border-white/[0.14] text-gray-200 hover:bg-white/[0.12]'
                      : 'bg-white/[0.03] border-white/[0.07] text-gray-600 hover:text-gray-300'
                  }`}
                >
                  {autoPlay ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {autoPlay ? 'Pause' : 'Auto'}
                </button>

                <button
                  onClick={() => { setStep(s => (s + 1) % steps.length); setAutoPlay(false); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-200 hover:bg-white/[0.06] transition-all duration-150"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
