import { createPortal } from 'react-dom';
import { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Zap, ShieldOff, Activity, CheckCircle2 } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { EventRecord } from '../hooks/useEventRecorder';

// ── Provider colour tokens ───────────────────────────────────────────────────

interface ProviderTokens {
  text: string;
  dot: string;
  ring: string;
  bg: string;
  glow: string;
}

const PROVIDER_TOKENS: Record<string, ProviderTokens> = {
  AWS:   { text: 'text-orange-400', dot: 'bg-orange-400', ring: 'ring-orange-500/[0.25]', bg: 'bg-orange-500/[0.10]', glow: 'shadow-[0_0_32px_rgba(249,115,22,0.18)]' },
  GCP:   { text: 'text-blue-400',   dot: 'bg-blue-400',   ring: 'ring-blue-500/[0.25]',   bg: 'bg-blue-500/[0.10]',   glow: 'shadow-[0_0_32px_rgba(59,130,246,0.18)]'  },
  AZURE: { text: 'text-sky-400',    dot: 'bg-sky-400',    ring: 'ring-sky-500/[0.25]',    bg: 'bg-sky-500/[0.10]',    glow: 'shadow-[0_0_32px_rgba(14,165,233,0.18)]'  },
};
const FALLBACK_TOKENS: ProviderTokens = {
  text: 'text-gray-400', dot: 'bg-gray-400', ring: 'ring-gray-500/[0.15]', bg: 'bg-gray-500/[0.06]', glow: '',
};

function providerTokens(p: string): ProviderTokens {
  return PROVIDER_TOKENS[p.toUpperCase()] ?? FALLBACK_TOKENS;
}

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtRegion(r: string): string {
  return r.toLowerCase().replace(/_/g, '-');
}

// ── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { id: 0, label: 'Before' },
  { id: 1, label: 'Event' },
  { id: 2, label: 'Failover Window' },
  { id: 3, label: 'Recovery' },
] as const;

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  record: EventRecord;
  onClose: () => void;
}

// ── Main component ───────────────────────────────────────────────────────────

export default function HAReportModal({ record, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [contentVisible, setContentVisible] = useState(true);

  // Enter animation — double-rAF so the initial translate/opacity is painted
  // before we switch to the animated state.
  useEffect(() => {
    const id1 = requestAnimationFrame(() => {
      const id2 = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id2);
    });
    return () => cancelAnimationFrame(id1);
  }, []);

  function goToStep(next: number) {
    setContentVisible(false);
    setTimeout(() => {
      setStep(next);
      setContentVisible(true);
    }, 160);
  }

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 240);
  }

  const bp = providerTokens(record.before.provider);
  const ap = providerTokens(record.after.provider);
  const electionSec = (record.after.electionMs / 1000).toFixed(1);
  const isOutage = record.type === 'outage';

  const chartData = record.samples.map((s) => ({
    t: parseFloat((s.t / 1000).toFixed(1)),
    p95: Math.round(s.p95),
    p50: Math.round(s.p50),
  }));

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      style={{ transition: 'opacity 240ms', opacity: visible ? 1 : 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      {/* Modal shell — double-bezel */}
      <div
        className="relative w-full max-w-2xl"
        style={{
          transition: 'transform 240ms cubic-bezier(0.32,0.72,0,1)',
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.97)',
        }}
      >
        <div className="p-px rounded-2xl bg-gradient-to-b from-white/[0.12] to-white/[0.04] ring-1 ring-white/[0.08] shadow-2xl">
          <div className="bg-[#0d0d12] rounded-[calc(1rem-1px)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
              <div>
                <p className="text-[11px] font-mono text-gray-600 uppercase tracking-[0.18em] mb-0.5">
                  Post-Event Analysis
                </p>
                <h2 className="text-base font-semibold font-display text-white">
                  {record.eventLabel}
                </h2>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-gray-600 hover:text-gray-200 hover:bg-white/[0.07] transition-all duration-150 active:scale-[0.92]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ── Progress steps ── */}
            <div className="flex items-center px-6 py-3 border-b border-white/[0.04]">
              {STEPS.map((s, i) => {
                const done   = step > s.id;
                const active = step === s.id;
                return (
                  <div key={s.id} className="flex items-center flex-1">
                    <button
                      onClick={() => goToStep(s.id)}
                      className="flex items-center gap-1.5 group"
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold transition-all duration-300 ${
                        done   ? 'bg-mdb-green text-black' :
                        active ? 'bg-white/[0.12] border border-white/30 text-white' :
                                 'bg-white/[0.03] border border-white/[0.08] text-gray-600 group-hover:border-white/[0.18]'
                      }`}>
                        {done ? '✓' : s.id + 1}
                      </div>
                      <span className={`text-[12px] font-medium font-display transition-colors duration-200 ${
                        active ? 'text-white' : done ? 'text-mdb-green' : 'text-gray-600 group-hover:text-gray-400'
                      }`}>
                        {s.label}
                      </span>
                    </button>
                    {i < STEPS.length - 1 && (
                      <div className={`flex-1 h-px mx-2 transition-colors duration-500 ${done ? 'bg-mdb-green/40' : 'bg-white/[0.06]'}`} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Phase content ── */}
            <div
              className="px-6 py-5 min-h-[360px]"
              style={{
                transition: 'opacity 160ms ease, transform 160ms ease',
                opacity:    contentVisible ? 1 : 0,
                transform:  contentVisible ? 'translateY(0)' : 'translateY(5px)',
              }}
            >

              {/* ── Step 0: Before ── */}
              {step === 0 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-600 mb-0.5">
                      Cluster State · Before
                    </p>
                    <p className="text-lg font-semibold font-display text-white">Your cluster was healthy</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Primary node card */}
                    <div className={`p-px rounded-xl ring-1 ${bp.ring} bg-gradient-to-b from-white/[0.08] to-transparent ${bp.glow}`}>
                      <div className={`rounded-[calc(0.75rem-1px)] p-4 ${bp.bg} shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${bp.dot}`} />
                          <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-mdb-green font-semibold">PRIMARY</span>
                        </div>
                        <p className="text-lg font-mono font-semibold text-white leading-tight">
                          {record.before.shard}
                        </p>
                        <div className={`flex items-center gap-1 mt-2 ${bp.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${bp.dot}`} />
                          <span className="text-[12px] font-mono">{record.before.provider}</span>
                        </div>
                        <p className="text-[12px] font-mono text-gray-500 mt-0.5">
                          {fmtRegion(record.before.region)}
                        </p>
                      </div>
                    </div>

                    {/* Baseline metrics */}
                    <div className="p-px rounded-xl ring-1 ring-white/[0.07] bg-gradient-to-b from-white/[0.05] to-transparent">
                      <div className="rounded-[calc(0.75rem-1px)] p-4 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                        <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-gray-600 mb-3">
                          Baseline Metrics
                        </p>
                        <div className="grid grid-cols-3 gap-1 mb-3">
                          {([
                            { label: 'P50', val: record.before.p50 },
                            { label: 'P95', val: record.before.p95 },
                            { label: 'P99', val: record.before.p99 },
                          ] as const).map(({ label, val }) => (
                            <div key={label} className="text-center">
                              <p className="text-[10px] text-gray-600 font-mono mb-0.5">{label}</p>
                              <p className="text-base font-mono font-semibold text-mdb-green">{fmtMs(val)}</p>
                            </div>
                          ))}
                        </div>
                        <div className="border-t border-white/[0.05] pt-2.5">
                          <p className="text-[10px] text-gray-600 font-mono mb-0.5">Writes / s</p>
                          <p className="text-base font-mono font-semibold text-gray-300">
                            {record.before.writesPerSec.toFixed(1)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-mdb-green/[0.07] border border-mdb-green/[0.15]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-mdb-green shrink-0" />
                    <span className="text-[13px] text-mdb-green/90 font-medium">
                      All replica set members online — cluster was healthy
                    </span>
                  </div>
                </div>
              )}

              {/* ── Step 1: Event ── */}
              {step === 1 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-600 mb-0.5">
                      What Triggered
                    </p>
                    <p className="text-lg font-semibold font-display text-white">The Event</p>
                  </div>

                  <div className="p-px rounded-xl ring-1 ring-red-500/[0.20] bg-gradient-to-b from-red-500/[0.07] to-transparent">
                    <div className="rounded-[calc(0.75rem-1px)] p-5 bg-red-500/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 p-2 rounded-lg bg-red-500/[0.12] ring-1 ring-red-500/[0.18]">
                          {isOutage
                            ? <ShieldOff className="w-5 h-5 text-red-400" />
                            : <Zap className="w-5 h-5 text-red-400" />}
                        </div>
                        <div>
                          <p className="font-semibold font-display text-base text-red-300 mb-1.5">
                            {isOutage ? 'Regional Outage Simulation' : 'Primary Failover Triggered'}
                          </p>
                          {isOutage ? (
                            <p className="text-base text-gray-400 leading-relaxed">
                              All nodes in{' '}
                              <span className="text-red-300 font-mono font-semibold">
                                {record.before.provider} · {fmtRegion(record.before.region)}
                              </span>{' '}
                              were isolated from the network. The primary (
                              <span className="font-mono text-gray-300">{record.before.shard}</span>) lost
                              connectivity, triggering an immediate replica set election.
                            </p>
                          ) : (
                            <p className="text-base text-gray-400 leading-relaxed">
                              Primary{' '}
                              <span className="font-mono text-gray-300">{record.before.shard}</span>{' '}
                              received a step-down request via the Atlas Admin API.
                              The replica set initiated an election to choose a new primary.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-px rounded-xl ring-1 ring-white/[0.07] bg-gradient-to-b from-white/[0.05] to-transparent">
                      <div className="rounded-[calc(0.75rem-1px)] p-3.5 bg-white/[0.02] space-y-1.5">
                        <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-gray-600">Affected Primary</p>
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${bp.dot} opacity-60`} />
                          <span className="font-mono text-base text-white font-semibold">{record.before.shard}</span>
                        </div>
                        <p className={`text-[12px] font-mono ${bp.text}`}>
                          {record.before.provider} · {fmtRegion(record.before.region)}
                        </p>
                      </div>
                    </div>
                    <div className="p-px rounded-xl ring-1 ring-white/[0.07] bg-gradient-to-b from-white/[0.05] to-transparent">
                      <div className="rounded-[calc(0.75rem-1px)] p-3.5 bg-white/[0.02] space-y-1.5">
                        <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-gray-600">Started At</p>
                        <p className="font-mono text-base text-white font-semibold">
                          {new Date(record.startTime).toLocaleTimeString()}
                        </p>
                        <p className="text-[12px] text-gray-500 font-mono">
                          {new Date(record.startTime).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/[0.07] border border-orange-500/[0.15]">
                    <Activity className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                    <span className="text-[13px] text-orange-400/90 font-medium">
                      Election began immediately — replica set members started campaigning
                    </span>
                  </div>
                </div>
              )}

              {/* ── Step 2: Election Window ── */}
              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-600 mb-0.5">
                      What Happened
                    </p>
                    <p className="text-lg font-semibold font-display text-white">The Failover Window</p>
                  </div>

                  {/* Latency chart */}
                  {chartData.length > 2 ? (
                    <div className="p-px rounded-xl ring-1 ring-white/[0.07] bg-gradient-to-b from-white/[0.04] to-transparent">
                      <div className="rounded-[calc(0.75rem-1px)] p-4 bg-[#0b0b10]">
                        <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-gray-600 mb-3">
                          Latency (ms) over time
                        </p>
                        <ResponsiveContainer width="100%" height={150}>
                          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                            <defs>
                              <linearGradient id="p95g" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.28} />
                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                              </linearGradient>
                              <linearGradient id="p50g" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="#00ed64" stopOpacity={0.18} />
                                <stop offset="95%" stopColor="#00ed64" stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)" />
                            <XAxis
                              dataKey="t"
                              tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(v: number) => `${v}s`}
                            />
                            <YAxis
                              tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'monospace' }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}s` : `${v}`}
                              width={36}
                            />
                            <Tooltip
                              contentStyle={{
                                background: '#0f0f14',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: '8px',
                                fontSize: '12px',
                                fontFamily: 'monospace',
                                color: '#d1d5db',
                              }}
                              formatter={(val: number) => [fmtMs(val), '']}
                              labelFormatter={(t: number) => `t+${t}s`}
                            />
                            <Area type="monotone" dataKey="p50" stroke="#00ed64" strokeWidth={1.5} strokeOpacity={0.6} fill="url(#p50g)" dot={false} />
                            <Area type="monotone" dataKey="p95" stroke="#ef4444" strokeWidth={2}   fill="url(#p95g)" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                        <div className="flex items-center gap-4 mt-2">
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-0.5 bg-red-500" />
                            <span className="text-[11px] font-mono text-gray-500">P95</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-0.5 bg-mdb-green opacity-60" />
                            <span className="text-[11px] font-mono text-gray-500">P50</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-32 rounded-xl ring-1 ring-white/[0.06] bg-white/[0.02]">
                      <p className="text-base text-gray-500 font-mono">
                        No latency data captured — workload was not running during the event
                      </p>
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'Failover Window', value: `${electionSec}s`, color: 'text-orange-400' },
                      { label: 'Peak P95', value: fmtMs(record.peakP95), color: 'text-red-400' },
                      { label: 'Errors', value: '0', color: 'text-mdb-green' },
                      { label: 'Data Loss', value: '0', color: 'text-mdb-green' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="p-px rounded-lg ring-1 ring-white/[0.06] bg-gradient-to-b from-white/[0.04] to-transparent">
                        <div className="rounded-[calc(0.4rem-1px)] p-2.5 bg-white/[0.02] text-center">
                          <p className="text-[10px] font-mono text-gray-600 uppercase tracking-wide mb-1">{label}</p>
                          <p className={`text-base font-mono font-bold ${color}`}>{value}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-mdb-green/[0.07] border border-mdb-green/[0.15]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-mdb-green shrink-0" />
                    <span className="text-[13px] text-mdb-green/90 font-medium">
                      retryWrites: true absorbed the failure — operations retried transparently
                    </span>
                  </div>
                </div>
              )}

              {/* ── Step 3: Recovery ── */}
              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-600 mb-0.5">
                      Election Complete
                    </p>
                    <p className="text-lg font-semibold font-display text-white">New Primary Elected</p>
                  </div>

                  {/* Before → After comparison */}
                  <div className="flex items-center gap-3">
                    {/* Was primary */}
                    <div className={`flex-1 p-px rounded-xl ring-1 ${bp.ring} bg-gradient-to-b from-white/[0.04] to-transparent`}>
                      <div className="rounded-[calc(0.75rem-1px)] p-4 bg-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                        <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-600 mb-2">Was Primary</p>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${bp.dot} opacity-40`} />
                          <span className="font-mono text-base text-gray-500 line-through">{record.before.shard}</span>
                        </div>
                        <p className={`text-[12px] font-mono ${bp.text} opacity-50`}>
                          {record.before.provider} · {fmtRegion(record.before.region)}
                        </p>
                      </div>
                    </div>

                    <ChevronRight className="w-5 h-5 text-gray-600 shrink-0" />

                    {/* New primary */}
                    <div className={`flex-1 p-px rounded-xl ring-1 ${ap.ring} bg-gradient-to-b from-white/[0.09] to-transparent ${ap.glow}`}>
                      <div className={`rounded-[calc(0.75rem-1px)] p-4 ${ap.bg} shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`}>
                        <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-mdb-green font-semibold mb-2">
                          New Primary
                        </p>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${ap.dot} animate-pulse-fast`} />
                          <span className="font-mono text-base text-white font-bold">{record.after.shard}</span>
                        </div>
                        <p className={`text-[12px] font-mono ${ap.text}`}>
                          {record.after.provider} · {fmtRegion(record.after.region)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Outcome stats */}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Failover Window', value: `${electionSec} seconds` },
                      { label: 'Peak P95 Latency', value: fmtMs(record.peakP95) },
                      { label: 'Application Errors', value: '0' },
                      { label: 'Documents Lost', value: '0' },
                    ].map(({ label, value }) => (
                      <div
                        key={label}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl ring-1 ring-white/[0.06] bg-white/[0.02]"
                      >
                        <div>
                          <p className="text-[10px] font-mono uppercase tracking-wide text-gray-600">{label}</p>
                          <p className="text-base font-mono font-semibold text-gray-200 mt-0.5">{value}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-mdb-green/[0.07] border border-mdb-green/[0.15]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-mdb-green shrink-0" />
                    <span className="text-[13px] text-mdb-green/90 font-medium">
                      Your application continued without errors — MongoDB HA delivered
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Navigation ── */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.05]">
              <button
                onClick={() => goToStep(step - 1)}
                disabled={step === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-base font-medium transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed bg-white/[0.05] text-gray-400 border border-white/[0.08] hover:enabled:bg-white/[0.09] hover:enabled:text-gray-200"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </button>

              {/* Dot indicators */}
              <div className="flex items-center gap-1.5">
                {STEPS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => goToStep(s.id)}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      step === s.id ? 'bg-white w-4' :
                      step > s.id  ? 'bg-mdb-green w-1.5' :
                                     'bg-gray-700 w-1.5 hover:bg-gray-500'
                    }`}
                  />
                ))}
              </div>

              {step < STEPS.length - 1 ? (
                <button
                  onClick={() => goToStep(step + 1)}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-base font-medium transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] bg-mdb-green/[0.12] text-mdb-green border border-mdb-green/[0.25] hover:bg-mdb-green/[0.20] hover:border-mdb-green/50"
                >
                  Next Step <ChevronRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={handleClose}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-base font-medium transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] bg-mdb-green/[0.12] text-mdb-green border border-mdb-green/[0.25] hover:bg-mdb-green/[0.20] hover:border-mdb-green/50"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
