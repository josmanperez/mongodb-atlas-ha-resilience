import { useState } from 'react';
import {
  Play,
  Square,
  Zap,
  AlertTriangle,
  RotateCcw,
  Globe,
  ShieldOff,
  Pencil,
} from 'lucide-react';
import { api } from '../api/client';
import type { PublicConfig } from '@atlas-demo/shared';

interface Props {
  config: PublicConfig | null;
  onScenarioChange: (id: string | null) => void;
  onToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  isRunning: boolean;
  defaultOutageProvider?: string;
  defaultOutageRegion?: string;
}

type ConfirmAction = 'failover' | 'outage_start' | 'outage_end' | 'reset';

export default function ScenarioLauncher({
  config,
  onScenarioChange,
  onToast,
  isRunning,
  defaultOutageProvider,
  defaultOutageRegion,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [outageProvider, setOutageProvider] = useState(defaultOutageProvider ?? 'AWS');
  const [outageRegion, setOutageRegion] = useState(defaultOutageRegion ?? 'US_EAST_1');
  const [editingTarget, setEditingTarget] = useState(false);

  const atlasEnabled = config?.atlasControlPlaneEnabled ?? false;
  const destructiveEnabled = config?.destructiveActionsEnabled ?? false;

  // Sync when Atlas data first arrives, only if user hasn't manually overridden
  const [providerTouched, setProviderTouched] = useState(false);
  const [regionTouched, setRegionTouched] = useState(false);
  if (defaultOutageProvider && !providerTouched && outageProvider !== defaultOutageProvider) {
    setOutageProvider(defaultOutageProvider);
  }
  if (defaultOutageRegion && !regionTouched && outageRegion !== defaultOutageRegion) {
    setOutageRegion(defaultOutageRegion);
  }

  const hasAtlasTarget = !!defaultOutageProvider;

  async function startWorkload(type: 'write' | 'read' | 'update' | 'mixed' | 'bulk') {
    if (loading || isRunning) return;
    setLoading(true);
    try {
      const handlers = {
        write: api.startWriteWorkload,
        read: api.startReadWorkload,
        update: api.startUpdateWorkload,
        mixed: api.startMixedWorkload,
        bulk: api.startBulkWorkload,
      };
      const res = await handlers[type]();
      if (res.success && res.data) {
        onScenarioChange(res.data.scenarioId);
        onToast(`${type} workload started`, 'success');
      } else {
        onToast(res.error ?? 'Failed to start workload', 'error');
      }
    } catch {
      onToast('Network error starting workload', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function stopWorkload() {
    if (loading) return;
    setLoading(true);
    try {
      await api.stopWorkload();
      onScenarioChange(null);
      onToast('Workload stop signal sent', 'info');
    } finally {
      setLoading(false);
    }
  }

  async function triggerFailover() {
    setLoading(true);
    setConfirmAction(null);
    try {
      const res = await api.triggerFailover(true);
      if (res.success) onToast('Failover triggered — election in progress', 'success');
      else onToast(res.error ?? 'Failover failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function startOutage() {
    setLoading(true);
    setConfirmAction(null);
    try {
      const res = await api.startOutage(true, outageProvider, outageRegion);
      if (res.success)
        onToast(`Outage simulation started: ${outageProvider}/${outageRegion}`, 'success');
      else onToast(res.error ?? 'Outage start failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function endOutage() {
    setLoading(true);
    setConfirmAction(null);
    try {
      const res = await api.endOutage();
      if (res.success) onToast('Outage simulation ended', 'success');
      else onToast(res.error ?? 'Outage end failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function resetDemo() {
    setLoading(true);
    setConfirmAction(null);
    try {
      const res = await api.resetDemo();
      if (res.success)
        onToast(`Reset complete — ${res.data?.deleted ?? 0} documents deleted`, 'info');
      else onToast(res.error ?? 'Reset failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  // Spring physics base — custom cubic-bezier for all interactive elements
  const SPRING = 'transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97]';

  const BASE = `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100 ${SPRING}`;
  const btnGreen = `${BASE} bg-mdb-green/[0.08] hover:bg-mdb-green/[0.15] text-mdb-green border border-mdb-green/20 hover:border-mdb-green/50 hover:-translate-y-px`;
  const btnRed   = `${BASE} bg-red-500/[0.08] hover:bg-red-500/[0.14] text-red-400 border border-red-500/20 hover:border-red-500/50 hover:-translate-y-px`;
  const btnOrange = `${BASE} bg-orange-500/[0.08] hover:bg-orange-500/[0.14] text-orange-400 border border-orange-500/20 hover:border-orange-500/50 hover:-translate-y-px`;
  const btnGray  = `${BASE} bg-white/[0.04] hover:bg-white/[0.07] text-gray-400 border border-white/[0.06] hover:border-white/[0.12] hover:-translate-y-px`;

  const CONFIRM_COPY: Record<ConfirmAction, string> = {
    failover: 'This will trigger a primary failover on your Atlas cluster. The cluster will be briefly unavailable during the replica set election.',
    outage_start: `Start an outage simulation for ${outageProvider} / ${outageRegion}. Nodes in that region will be taken offline.`,
    outage_end: 'End the active outage simulation and restore all affected nodes.',
    reset: 'Delete ALL documents from the resilience_events collection. This cannot be undone.',
  };

  return (
    <div className="p-3 space-y-3">
      <span className="text-[10px] font-semibold font-display text-gray-500 uppercase tracking-[0.15em]">
        Scenarios
      </span>

      {/* Workloads */}
      <div className="space-y-1">
        <p className="text-[9px] text-gray-600 uppercase tracking-[0.18em] font-display mb-1.5">
          Workloads
        </p>
        <button className={btnGreen} disabled={isRunning || loading} onClick={() => startWorkload('write')}>
          <Play className="w-3 h-3 shrink-0" /> Write Workload
        </button>
        <button className={btnGreen} disabled={isRunning || loading} onClick={() => startWorkload('read')}>
          <Play className="w-3 h-3 shrink-0" /> Read Workload
        </button>
        <button className={btnGreen} disabled={isRunning || loading} onClick={() => startWorkload('mixed')}>
          <Play className="w-3 h-3 shrink-0" /> Mixed Read/Write
        </button>
        <button className={btnGreen} disabled={isRunning || loading} onClick={() => startWorkload('update')}>
          <Play className="w-3 h-3 shrink-0" /> Update Workload
        </button>
        <button className={btnGreen} disabled={isRunning || loading} onClick={() => startWorkload('bulk')}>
          <Play className="w-3 h-3 shrink-0" /> Bulk Write
        </button>
        <button className={btnGray} disabled={!isRunning || loading} onClick={stopWorkload}>
          <Square className="w-3 h-3 shrink-0" /> Stop Workload
        </button>
      </div>

      {/* Atlas Control Plane */}
      <div className="space-y-1 border-t border-white/[0.05] pt-2.5">
        <p className="text-[10px] text-gray-400 uppercase tracking-[0.14em] font-display font-semibold mb-1.5">
          Atlas Control Plane
        </p>

        {!atlasEnabled && (
          <div className="text-[10px] text-yellow-600/80 bg-yellow-500/[0.06] border border-yellow-500/[0.15] rounded-lg p-2 flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>
              Set <span className="font-mono text-yellow-500/80">ENABLE_ATLAS_CONTROL_PLANE=true</span> to enable.
            </span>
          </div>
        )}

        <button
          className={btnOrange}
          disabled={!atlasEnabled || !destructiveEnabled || loading}
          onClick={() => setConfirmAction('failover')}
          title={!atlasEnabled ? 'Atlas control plane disabled' : !destructiveEnabled ? 'Set ENABLE_DESTRUCTIVE_ACTIONS=true' : 'Trigger primary failover'}
        >
          <Zap className="w-3 h-3 shrink-0" /> Trigger Failover
        </button>

        {!destructiveEnabled && atlasEnabled && (
          <p className="text-[9px] text-gray-600 px-1">
            Requires <span className="font-mono">ENABLE_DESTRUCTIVE_ACTIONS=true</span>
          </p>
        )}

        {/* Outage target — read-only display when Atlas data is present, editable on override */}
        {hasAtlasTarget && !editingTarget ? (
          <div className="flex items-center gap-1.5 pt-0.5">
            <div className="flex-1 flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.06] rounded-lg px-2.5 py-1.5">
              <span className="text-[10px] font-mono text-gray-400">{outageProvider}</span>
              <span className="text-gray-700">/</span>
              <span className="text-[10px] font-mono text-gray-400">{outageRegion}</span>
            </div>
            <button
              className="shrink-0 p-1.5 rounded-lg text-gray-600 hover:text-gray-400 hover:bg-white/[0.05] transition-colors duration-150"
              onClick={() => setEditingTarget(true)}
              title="Override outage target"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="flex gap-1 pt-0.5">
            <input
              className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-[10px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-mdb-green/40 focus:bg-white/[0.06] font-mono transition-colors duration-150"
              placeholder="Provider"
              value={outageProvider}
              onChange={(e) => { setProviderTouched(true); setOutageProvider(e.target.value); }}
            />
            <input
              className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1.5 text-[10px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-mdb-green/40 focus:bg-white/[0.06] font-mono transition-colors duration-150"
              placeholder="Region"
              value={outageRegion}
              onChange={(e) => { setRegionTouched(true); setOutageRegion(e.target.value); }}
            />
          </div>
        )}

        <button
          className={btnRed}
          disabled={!atlasEnabled || !destructiveEnabled || loading}
          onClick={() => setConfirmAction('outage_start')}
        >
          <ShieldOff className="w-3 h-3 shrink-0" /> Start Outage Simulation
        </button>
        <button
          className={btnGray}
          disabled={!atlasEnabled || loading}
          onClick={() => setConfirmAction('outage_end')}
        >
          <Globe className="w-3 h-3 shrink-0" /> End Outage Simulation
        </button>
      </div>

      {/* Demo reset */}
      <div className="border-t border-white/[0.05] pt-2">
        <button
          className={btnGray}
          disabled={loading || !destructiveEnabled}
          onClick={() => setConfirmAction('reset')}
          title={!destructiveEnabled ? 'Set ENABLE_DESTRUCTIVE_ACTIONS=true to reset' : 'Delete all demo data'}
        >
          <RotateCcw className="w-3 h-3 shrink-0" /> Reset Demo Dataset
        </button>
      </div>

      {/* Confirmation modal — glass morphism */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          {/* Double-bezel modal */}
          <div className="p-px rounded-2xl bg-gradient-to-b from-white/[0.10] to-white/[0.03] ring-1 ring-white/[0.08] shadow-2xl max-w-sm w-full">
            <div className="bg-[#0f0f14] rounded-[calc(1rem-1px)] p-5 space-y-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="flex items-center gap-2 text-orange-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="font-semibold font-display text-sm">Confirm Action</span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                {CONFIRM_COPY[confirmAction]}
              </p>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  className={`px-4 py-1.5 text-xs rounded-lg font-medium ${SPRING} bg-white/[0.05] text-gray-400 border border-white/[0.08] hover:bg-white/[0.08]`}
                  onClick={() => setConfirmAction(null)}
                >
                  Cancel
                </button>
                <button
                  className={`px-4 py-1.5 text-xs rounded-lg font-medium ${SPRING} bg-red-500/[0.15] text-red-300 border border-red-500/30 hover:bg-red-500/[0.25] hover:border-red-500/50`}
                  onClick={() => {
                    if (confirmAction === 'failover') triggerFailover();
                    else if (confirmAction === 'outage_start') startOutage();
                    else if (confirmAction === 'outage_end') endOutage();
                    else if (confirmAction === 'reset') resetDemo();
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
