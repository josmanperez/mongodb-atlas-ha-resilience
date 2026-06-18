import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Square,
  Zap,
  AlertTriangle,
  RotateCcw,
  Globe,
  ShieldOff,
  Pencil,
  PenLine,
  BookOpen,
  Layers,
  FileEdit,
  Database,
  ArrowRightLeft,
  ChevronDown,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import type { PublicConfig, WorkloadType } from '@atlas-demo/shared';

interface Props {
  config:               PublicConfig | null;
  onScenarioChange:     (id: string | null) => void;
  onToast:              (msg: string, type: 'success' | 'error' | 'info') => void;
  onFailover?:          () => void;
  onEventStart?:        (type: 'failover' | 'outage', label: string, currentPrimary: string | null) => void;
  currentPrimary?:      string | null;
  isRunning:            boolean;
  workloadType?:        WorkloadType | null;
  clusterState?:        string | null;
  clusterPaused?:       boolean;
  outageRegions?:       Array<{ provider: string; region: string; priority: number }>;
  defaultOutageProvider?: string;
  defaultOutageRegion?:   string;
  // Read preference lifted to App so FailoverExplainer can read it too
  readPref:             'primary' | 'secondaryPreferred';
  onReadPrefChange:     (p: 'primary' | 'secondaryPreferred') => void;
}

type ConfirmAction = 'failover' | 'outage_start' | 'outage_end' | 'reset';

// ── Workload type metadata ─────────────────────────────────────────────────────

const WORKLOAD_META: Record<
  'write' | 'read' | 'mixed' | 'update' | 'bulk',
  { label: string; icon: React.ReactNode; color: string; ring: string; live: string }
> = {
  write:  {
    label: 'Write Workload',
    icon:  <PenLine className="w-3.5 h-3.5 shrink-0" />,
    color: 'text-orange-400',
    ring:  'bg-orange-500/[0.10] border-orange-500/30 hover:bg-orange-500/[0.16] hover:border-orange-500/50',
    live:  'bg-orange-500/[0.14] border-orange-500/50 text-orange-300 ring-1 ring-orange-500/[0.25] shadow-[0_0_12px_rgba(249,115,22,0.12)]',
  },
  read:   {
    label: 'Read Workload',
    icon:  <BookOpen className="w-3.5 h-3.5 shrink-0" />,
    color: 'text-blue-400',
    ring:  'bg-blue-500/[0.08] border-blue-500/25 hover:bg-blue-500/[0.14] hover:border-blue-500/45',
    live:  'bg-blue-500/[0.14] border-blue-500/50 text-blue-300 ring-1 ring-blue-500/[0.25] shadow-[0_0_12px_rgba(59,130,246,0.12)]',
  },
  mixed:  {
    label: 'Mixed Read/Write',
    icon:  <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />,
    color: 'text-purple-400',
    ring:  'bg-purple-500/[0.08] border-purple-500/25 hover:bg-purple-500/[0.14] hover:border-purple-500/45',
    live:  'bg-purple-500/[0.14] border-purple-500/50 text-purple-300 ring-1 ring-purple-500/[0.25] shadow-[0_0_12px_rgba(168,85,247,0.12)]',
  },
  update: {
    label: 'Update Workload',
    icon:  <FileEdit className="w-3.5 h-3.5 shrink-0" />,
    color: 'text-yellow-400',
    ring:  'bg-yellow-500/[0.08] border-yellow-500/25 hover:bg-yellow-500/[0.14] hover:border-yellow-500/45',
    live:  'bg-yellow-500/[0.14] border-yellow-500/50 text-yellow-300 ring-1 ring-yellow-500/[0.25] shadow-[0_0_12px_rgba(234,179,8,0.12)]',
  },
  bulk:   {
    label: 'Bulk Write',
    icon:  <Layers className="w-3.5 h-3.5 shrink-0" />,
    color: 'text-cyan-400',
    ring:  'bg-cyan-500/[0.08] border-cyan-500/25 hover:bg-cyan-500/[0.14] hover:border-cyan-500/45',
    live:  'bg-cyan-500/[0.14] border-cyan-500/50 text-cyan-300 ring-1 ring-cyan-500/[0.25] shadow-[0_0_12px_rgba(6,182,212,0.12)]',
  },
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function ScenarioLauncher({
  config,
  onScenarioChange,
  onToast,
  onFailover,
  onEventStart,
  currentPrimary = null,
  isRunning,
  workloadType,
  clusterState,
  clusterPaused = false,
  outageRegions,
  defaultOutageProvider,
  defaultOutageRegion,
  readPref,
  onReadPrefChange,
}: Props) {
  const [loading,        setLoading]        = useState(false);
  const [confirmAction,  setConfirmAction]  = useState<ConfirmAction | null>(null);
  const [outageProvider, setOutageProvider] = useState(defaultOutageProvider ?? 'AWS');
  const [outageRegion,   setOutageRegion]   = useState(defaultOutageRegion ?? 'US_EAST_1');
  const [editingTarget,  setEditingTarget]  = useState(false);
  const [providerTouched, setProviderTouched] = useState(false);
  const [regionTouched,   setRegionTouched]   = useState(false);
  // Optimistic "stopped" flag — SSE metrics may lag behind after stop API call
  const [localStopped,   setLocalStopped]   = useState(false);
  // Outage simulation status polled from Atlas Admin API
  const [outageSimStatus, setOutageSimStatus] = useState<string | null>(null);
  const outagePollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear optimistic flag once SSE confirms the workload has stopped
  useEffect(() => {
    if (!isRunning) setLocalStopped(false);
  }, [isRunning]);

  // Sync outage target from props when user hasn't manually overridden.
  // Prefer the highest-priority region from the full region list; fall back to the
  // single default values for single-region clusters.
  useEffect(() => {
    if (providerTouched || regionTouched) return;
    if (outageRegions && outageRegions.length > 0) {
      setOutageProvider(outageRegions[0].provider);
      setOutageRegion(outageRegions[0].region);
    } else if (defaultOutageProvider) {
      setOutageProvider(defaultOutageProvider);
      if (defaultOutageRegion) setOutageRegion(defaultOutageRegion);
    }
  }, [outageRegions, defaultOutageProvider, defaultOutageRegion, providerTouched, regionTouched]);

  const effectivelyRunning = isRunning && !localStopped;

  // ── Outage simulation status polling ────────────────────────────────────────

  const stopOutagePoller = useCallback(() => {
    if (outagePollerRef.current) {
      clearInterval(outagePollerRef.current);
      outagePollerRef.current = null;
    }
  }, []);

  const pollOutageStatus = useCallback(async () => {
    try {
      const res = await api.outageStatus();
      if (res.success && res.data) {
        // Atlas Admin API v2 returns `state`, not `simulationStatus`
        const state = (res.data as Record<string, unknown>).state as string | undefined;
        if (!state || state === 'IDLE') {
          setOutageSimStatus(null);
          stopOutagePoller();
        } else {
          setOutageSimStatus(state);
        }
      }
    } catch {
      // 404 = no active simulation — clear status and stop polling
      setOutageSimStatus(null);
      stopOutagePoller();
    }
  }, [stopOutagePoller]);

  const startOutagePoller = useCallback(() => {
    stopOutagePoller();
    outagePollerRef.current = setInterval(pollOutageStatus, 5_000);
  }, [pollOutageStatus, stopOutagePoller]);

  // Clean up poller on unmount
  useEffect(() => () => stopOutagePoller(), [stopOutagePoller]);

  const atlasEnabled     = config?.atlasControlPlaneEnabled ?? false;
  const destructiveEnabled = config?.destructiveActionsEnabled ?? false;
  const clusterBusy      = !!clusterState && clusterState !== 'IDLE';
  const hasAtlasTarget   = !!defaultOutageProvider;

  // On mount (or when atlas becomes enabled), check for an existing simulation so a
  // page refresh during an active outage still shows the status chip and polls.
  useEffect(() => {
    if (!atlasEnabled) return;
    let live = true;
    api.outageStatus()
      .then(res => {
        if (!live || !res.success || !res.data) return;
        const state = (res.data as Record<string, unknown>).state as string | undefined;
        if (state && state !== 'IDLE') {
          setOutageSimStatus(state);
          if (!outagePollerRef.current) {
            outagePollerRef.current = setInterval(pollOutageStatus, 5_000);
          }
        }
      })
      .catch(() => { /* 404 = no active simulation — expected */ });
    return () => { live = false; };
  }, [atlasEnabled, pollOutageStatus]);

  const SPRING = 'transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97]';

  // ── Workload handlers ──────────────────────────────────────────────────────

  async function startWorkload(type: 'write' | 'read' | 'update' | 'mixed' | 'bulk') {
    if (loading || effectivelyRunning) return;
    setLocalStopped(false); // Clear stale stop flag from a previous stop that SSE hasn't confirmed yet
    setLoading(true);
    const cfg = (type === 'read' || type === 'mixed') ? { readPreference: readPref } : undefined;
    try {
      const handlers = {
        write:  api.startWriteWorkload,
        read:   api.startReadWorkload,
        update: api.startUpdateWorkload,
        mixed:  api.startMixedWorkload,
        bulk:   api.startBulkWorkload,
      };
      const res = await handlers[type](cfg);
      if (res.success && res.data) { onScenarioChange(res.data.scenarioId); onToast(`${type} workload started`, 'success'); }
      else onToast(res.error ?? 'Failed to start workload', 'error');
    } catch { onToast('Network error', 'error'); }
    finally  { setLoading(false); }
  }

  async function stopWorkload() {
    if (loading) return;
    setLoading(true);
    setLocalStopped(true); // Optimistic: clear LIVE badge before SSE confirms
    try { await api.stopWorkload(); onScenarioChange(null); onToast('Workload stopped', 'info'); }
    catch { setLocalStopped(false); onToast('Failed to stop workload', 'error'); }
    finally { setLoading(false); }
  }

  async function triggerFailover() {
    setLoading(true); setConfirmAction(null);
    onEventStart?.('failover', 'Primary Failover', currentPrimary);
    try {
      const res = await api.triggerFailover(true);
      if (res.success) { onToast('Failover triggered — election in progress', 'success'); onFailover?.(); }
      else onToast(res.error ?? 'Failover failed', 'error');
    } finally { setLoading(false); }
  }

  async function startOutage() {
    setLoading(true); setConfirmAction(null);
    onEventStart?.('outage', `${outageProvider} Outage Simulation`, currentPrimary);
    try {
      const res = await api.startOutage(true, outageProvider, outageRegion);
      if (res.success) {
        onToast(`Outage started: ${outageProvider}/${outageRegion}`, 'success');
        setOutageSimStatus('START_REQUESTED');
        startOutagePoller();
      } else {
        onToast(res.error ?? 'Outage start failed', 'error');
      }
    } finally { setLoading(false); }
  }

  async function endOutage() {
    setLoading(true); setConfirmAction(null);
    try {
      const res = await api.endOutage();
      if (res.success) {
        onToast('Outage ended', 'success');
        setOutageSimStatus('STOP_REQUESTED');
        startOutagePoller(); // Keep polling until Atlas confirms IDLE
      } else {
        onToast(res.error ?? 'Outage end failed', 'error');
      }
    } finally { setLoading(false); }
  }

  async function resetDemo() {
    setLoading(true); setConfirmAction(null);
    try {
      const res = await api.resetDemo();
      if (res.success) onToast(`Reset complete — ${res.data?.deleted ?? 0} docs deleted`, 'info');
      else onToast(res.error ?? 'Reset failed', 'error');
    } finally { setLoading(false); }
  }

  const CONFIRM_COPY: Record<ConfirmAction, string> = {
    failover:     'Trigger a primary failover on your Atlas cluster. The replica set will hold an election — typically 3–7 s on Atlas.',
    outage_start: `Simulate a regional outage for ${outageProvider} / ${outageRegion}. Nodes in that region go offline until you end the simulation.`,
    outage_end:   'End the active outage simulation and restore all affected nodes.',
    reset:        'Delete ALL documents from the resilience_events collection. This cannot be undone.',
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-3 space-y-4">

      {/* ── Section header ── */}
      <div className="flex items-center gap-2">
        <Database className="w-3.5 h-3.5 text-gray-600 shrink-0" />
        <span className="text-[10px] font-semibold font-display text-gray-500 uppercase tracking-[0.16em]">
          Scenarios
        </span>
      </div>

      {/* ── Running state banner ── */}
      {effectivelyRunning && workloadType && (() => {
        const m = WORKLOAD_META[workloadType];
        return (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${m.live}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse-fast shrink-0" />
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wide flex-1 truncate">
              {workloadType} running
            </span>
            <button
              onClick={stopWorkload}
              disabled={loading}
              className="shrink-0 p-1 rounded-md bg-black/20 hover:bg-black/40 transition-colors duration-150 disabled:opacity-40"
              title="Stop workload"
            >
              <Square className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })()}

      {/* ── Read Routing toggle ── */}
      <div className="space-y-1.5">
        <p className="text-[9px] font-display font-semibold text-gray-500 uppercase tracking-[0.16em]">
          Read Routing
        </p>
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/30 border border-white/[0.06]">
          {(['primary', 'secondaryPreferred'] as const).map(pref => {
            const active = readPref === pref;
            return (
              <button
                key={pref}
                onClick={() => onReadPrefChange(pref)}
                disabled={effectivelyRunning}
                className={`flex flex-col items-center gap-0.5 py-2 px-1.5 rounded-[0.6rem] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] disabled:opacity-50 ${
                  active
                    ? pref === 'secondaryPreferred'
                      ? 'bg-blue-500/[0.18] border border-blue-500/40 text-blue-300'
                      : 'bg-white/[0.09] border border-white/[0.16] text-white'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
              >
                <span className="text-[10px] font-medium font-display leading-none">
                  {pref === 'primary' ? 'Primary' : 'Secondary ✦'}
                </span>
                <span className="text-[8px] font-mono opacity-70 leading-tight text-center">
                  {pref === 'primary' ? 'freshest data' : 'zero-impact HA'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Workload buttons ── */}
      <div className="space-y-1">
        {(Object.entries(WORKLOAD_META) as [keyof typeof WORKLOAD_META, typeof WORKLOAD_META[keyof typeof WORKLOAD_META]][]).map(([type, meta]) => {
          const isLive     = effectivelyRunning && workloadType === type;
          const isDisabled = (effectivelyRunning && !isLive) || loading || clusterPaused;
          return (
            <button
              key={type}
              disabled={isDisabled || isLive}
              onClick={() => startWorkload(type)}
              title={clusterPaused ? 'Resume the cluster before starting a workload' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-medium ${SPRING} disabled:cursor-not-allowed ${
                isLive
                  ? `${meta.live} cursor-default`
                  : isDisabled
                  ? 'opacity-25 bg-white/[0.02] border-white/[0.05] text-gray-600'
                  : `${meta.color} ${meta.ring} border hover:-translate-y-px`
              }`}
            >
              {isLive
                ? <span className="w-2 h-2 rounded-full bg-current animate-pulse-fast shrink-0" />
                : meta.icon}
              <span className="flex-1 text-left">{meta.label}</span>
              {isLive && (
                <span className="text-[8px] font-mono font-semibold uppercase tracking-wider opacity-80">
                  LIVE
                </span>
              )}
            </button>
          );
        })}

        {/* Stop — only shows when nothing is running */}
        {!effectivelyRunning && (
          <button
            disabled={loading}
            onClick={stopWorkload}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-medium opacity-30 bg-white/[0.02] border-white/[0.05] text-gray-600 cursor-not-allowed ${SPRING}`}
          >
            <Square className="w-3.5 h-3.5 shrink-0" />
            Stop Workload
          </button>
        )}
      </div>

      {/* ── Atlas Control Plane ── */}
      <div className="space-y-2 border-t border-white/[0.05] pt-3">
        <p className="text-[9px] font-display font-semibold text-gray-500 uppercase tracking-[0.16em]">
          Atlas Control Plane
        </p>

        {!atlasEnabled && (
          <div className="text-[10px] text-yellow-600/80 bg-yellow-500/[0.06] border border-yellow-500/[0.15] rounded-lg p-2 flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>Set <span className="font-mono text-yellow-500/80">ENABLE_ATLAS_CONTROL_PLANE=true</span> to enable.</span>
          </div>
        )}

        <button
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-medium ${SPRING} disabled:opacity-30 disabled:cursor-not-allowed bg-orange-500/[0.08] border-orange-500/25 text-orange-400 hover:bg-orange-500/[0.15] hover:border-orange-500/50 hover:-translate-y-px`}
          disabled={!atlasEnabled || !destructiveEnabled || loading || clusterBusy}
          onClick={() => setConfirmAction('failover')}
          title={
            !atlasEnabled ? 'Atlas control plane disabled'
            : !destructiveEnabled ? 'Set ENABLE_DESTRUCTIVE_ACTIONS=true'
            : clusterBusy ? `Cluster ${clusterState} — wait for IDLE`
            : 'Trigger primary failover'
          }
        >
          <Zap className="w-3.5 h-3.5 shrink-0" />
          {clusterBusy ? 'Election in progress…' : 'Trigger Failover'}
        </button>

        {clusterBusy && atlasEnabled && (
          <div className="flex items-center gap-1.5 px-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse shrink-0" />
            <span className="text-[9px] text-orange-400/80 font-mono">{clusterState} — election underway</span>
          </div>
        )}

        {/* Outage target */}
        {outageRegions && outageRegions.length > 0 && !editingTarget ? (
          // Multi-region: dropdown listing all electable regions sorted by priority
          <div className="flex items-center gap-1.5">
            {/* Doppelrand wrapper — gradient hairline ring around the native select */}
            <div className="relative flex-1 p-px rounded-lg bg-gradient-to-b from-white/[0.10] to-white/[0.03] ring-1 ring-white/[0.06]">
              <select
                value={`${outageProvider}||${outageRegion}`}
                onChange={e => {
                  const [p, r] = e.target.value.split('||');
                  setOutageProvider(p);
                  setOutageRegion(r);
                }}
                className="w-full appearance-none bg-[#0c0c10] rounded-[calc(0.5rem-1px)] pl-2.5 pr-7 py-1.5 text-[10px] text-gray-300 font-mono focus:outline-none transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              >
                {outageRegions.map(r => (
                  <option key={`${r.provider}||${r.region}`} value={`${r.provider}||${r.region}`}>
                    {r.provider} / {r.region}{r.priority === 7 ? '  ★' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600 pointer-events-none" />
            </div>
            <button
              className="shrink-0 p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-white/[0.06] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.92]"
              onClick={() => setEditingTarget(true)}
              title="Enter custom outage target"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
        ) : hasAtlasTarget && !editingTarget ? (
          // Single-region: read-only display with edit override
          <div className="flex items-center gap-1.5">
            <div className="flex-1 flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded-lg px-2.5 py-1.5">
              <span className="text-[10px] font-mono text-gray-400">{outageProvider}</span>
              <span className="text-gray-700 text-xs">/</span>
              <span className="text-[10px] font-mono text-gray-400">{outageRegion}</span>
            </div>
            <button
              className="shrink-0 p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-white/[0.05] transition-colors duration-150"
              onClick={() => setEditingTarget(true)}
              title="Override outage target"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
        ) : (
          // Manual text inputs (no Atlas data, or user clicked override)
          <div className="flex gap-1">
            <input
              className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-[10px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-mdb-green/40 font-mono transition-colors duration-150"
              placeholder="Provider"
              value={outageProvider}
              onChange={e => { setProviderTouched(true); setOutageProvider(e.target.value); }}
            />
            <input
              className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-[10px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-mdb-green/40 font-mono transition-colors duration-150"
              placeholder="Region"
              value={outageRegion}
              onChange={e => { setRegionTouched(true); setOutageRegion(e.target.value); }}
            />
            {outageRegions && outageRegions.length > 0 && (
              <button
                className="shrink-0 p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-white/[0.05] transition-colors duration-150"
                onClick={() => { setEditingTarget(false); setProviderTouched(false); setRegionTouched(false); }}
                title="Back to region list"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        <button
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-medium ${SPRING} disabled:opacity-30 disabled:cursor-not-allowed bg-red-500/[0.08] border-red-500/20 text-red-400 hover:bg-red-500/[0.14] hover:border-red-500/45 hover:-translate-y-px`}
          disabled={!atlasEnabled || !destructiveEnabled || loading || !!outageSimStatus}
          onClick={() => setConfirmAction('outage_start')}
        >
          <ShieldOff className="w-3.5 h-3.5 shrink-0" /> Start Outage Simulation
        </button>
        <button
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-medium ${SPRING} disabled:opacity-30 disabled:cursor-not-allowed bg-white/[0.04] border-white/[0.07] text-gray-400 hover:bg-white/[0.08] hover:border-white/[0.13] hover:-translate-y-px`}
          disabled={!atlasEnabled || loading || outageSimStatus !== 'SIMULATING'}
          title={
            outageSimStatus && outageSimStatus !== 'SIMULATING'
              ? `Waiting for simulation to be ready (${outageSimStatus?.replace(/_/g, ' ')})…`
              : !outageSimStatus ? 'No active outage simulation'
              : 'End the active outage simulation'
          }
          onClick={() => setConfirmAction('outage_end')}
        >
          <Globe className="w-3.5 h-3.5 shrink-0" /> End Outage Simulation
        </button>

        {/* Outage simulation status — polled from Atlas Admin API.
            Always rendered; max-h/opacity animate it in and out smoothly. */}
        {(() => {
          // Atlas Admin API v2 state values: START_REQUESTED → SIMULATING → RECOVERY → IDLE
          const isActive   = outageSimStatus === 'SIMULATING';
          const isStopping = outageSimStatus === 'RECOVERY';
          const shell = isActive
            ? 'bg-gradient-to-b from-red-500/[0.22] to-red-500/[0.05] ring-1 ring-red-500/[0.14]'
            : isStopping
            ? 'bg-gradient-to-b from-yellow-500/[0.18] to-yellow-500/[0.04] ring-1 ring-yellow-500/[0.12]'
            : 'bg-gradient-to-b from-orange-500/[0.18] to-orange-500/[0.04] ring-1 ring-orange-500/[0.12]';
          const core = isActive ? 'bg-red-500/[0.08]' : isStopping ? 'bg-yellow-500/[0.07]' : 'bg-orange-500/[0.07]';
          const dot  = isActive ? 'bg-red-400' : isStopping ? 'bg-yellow-400 animate-pulse' : 'bg-orange-400 animate-pulse';
          const text = isActive ? 'text-red-400' : isStopping ? 'text-yellow-400' : 'text-orange-400';
          const glow = isActive ? 'bg-red-500/25' : isStopping ? 'bg-yellow-500/20' : 'bg-orange-500/20';
          return (
            <div className={`overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              outageSimStatus ? 'max-h-12 opacity-100' : 'max-h-0 opacity-0'
            }`}>
              <div className="relative">
                <div className={`absolute inset-0 pointer-events-none rounded-lg blur-xl ${glow}`} />
                <div className={`relative p-px rounded-lg ${shell}`}>
                  <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[calc(0.5rem-1px)] ${core} shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                    <span className={`text-[9px] font-mono font-semibold tracking-wide flex-1 ${text}`}>
                      {outageSimStatus?.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Demo reset ── */}
      <div className="border-t border-white/[0.05] pt-2">
        <button
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs font-medium ${SPRING} disabled:opacity-30 disabled:cursor-not-allowed bg-white/[0.03] border-white/[0.06] text-gray-500 hover:bg-white/[0.06] hover:border-white/[0.11] hover:text-gray-300 hover:-translate-y-px`}
          disabled={loading || !destructiveEnabled}
          onClick={() => setConfirmAction('reset')}
        >
          <RotateCcw className="w-3.5 h-3.5 shrink-0" /> Reset Demo Dataset
        </button>
      </div>

      {/* ── Confirm modal — rendered via portal so fixed inset-0 covers the full viewport
           even when this component is inside an overflow-y-auto sidebar ── */}
      {confirmAction && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="p-px rounded-2xl bg-gradient-to-b from-white/[0.10] to-white/[0.03] ring-1 ring-white/[0.08] shadow-2xl max-w-sm w-full">
            <div className="bg-[#0f0f14] rounded-[calc(1rem-1px)] p-5 space-y-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="flex items-center gap-2 text-orange-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="font-semibold font-display text-sm">Confirm Action</span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">{CONFIRM_COPY[confirmAction]}</p>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  className={`px-4 py-1.5 text-xs rounded-lg font-medium ${SPRING} bg-white/[0.05] text-gray-400 border border-white/[0.08] hover:bg-white/[0.09]`}
                  onClick={() => setConfirmAction(null)}
                >
                  Cancel
                </button>
                <button
                  className={`px-4 py-1.5 text-xs rounded-lg font-medium ${SPRING} bg-red-500/[0.15] text-red-300 border border-red-500/30 hover:bg-red-500/[0.25] hover:border-red-500/50`}
                  onClick={() => {
                    if (confirmAction === 'failover')          triggerFailover();
                    else if (confirmAction === 'outage_start') startOutage();
                    else if (confirmAction === 'outage_end')   endOutage();
                    else if (confirmAction === 'reset')        resetDemo();
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
