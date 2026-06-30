import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, FileText, Settings } from 'lucide-react';
import { useSSE } from './hooks/useSSE';
import { useAtlas } from './hooks/useAtlas';
import { useEventRecorder } from './hooks/useEventRecorder';
import ClusterPausedBanner from './components/ClusterPausedBanner';
import TopologyPanel from './components/TopologyPanel';
import ScenarioLauncher from './components/ScenarioLauncher';
import Terminal from './components/Terminal';
import KPIPanel from './components/KPIPanel';
import ScenarioNotes from './components/ScenarioNotes';
import ConnectionBadge from './components/ConnectionBadge';
import ProviderBadge from './components/ProviderBadge';
import FailoverExplainer from './components/FailoverExplainer';
import HAReportModal from './components/HAReportModal';
import SettingsModal, { restoreConnectionOverride } from './components/SettingsModal';

type ToastType = 'success' | 'error' | 'info';
interface Toast { message: string; type: ToastType; }

const TOAST_BG: Record<ToastType, string> = {
  success: 'bg-mdb-green text-black',
  error:   'bg-red-600 text-white',
  info:    'bg-gray-700 text-white',
};

const FAILOVER_RECENT_MS = 5 * 60 * 1000; // 5 min

export default function App() {
  const { connected, terminalEvents, csEvents, metrics, clearTerminal } = useSSE();
  const { config, clusterInfo, processes, driverPrimary, processesLoading, loading, error, refresh, startBurstRefresh, resumeCluster, nodeRegionMap } = useAtlas();
  const { startRecording, showReport, record, dismissReport } = useEventRecorder({ metrics, driverPrimary, nodeRegionMap });

  const [activeScenario,   setActiveScenario]   = useState<string | null>(null);
  const [toast,            setToast]            = useState<Toast | null>(null);
  const [readPref,         setReadPref]         = useState<'primary' | 'secondaryPreferred'>('primary');
  const [lastFailoverAt,   setLastFailoverAt]   = useState<number | null>(null);
  const [leftOpen,         setLeftOpen]         = useState(true);
  const [rightOpen,        setRightOpen]        = useState(true);
  const [reportOpen,       setReportOpen]       = useState(false);
  const [settingsOpen,     setSettingsOpen]     = useState(false);

  // Re-apply any saved connection override whenever the SSE comes (back) up.
  // This covers both initial load and API restarts (which wipe the in-memory override).
  const prevConnected = useRef(false);
  useEffect(() => {
    if (connected && !prevConnected.current) restoreConnectionOverride();
    prevConnected.current = connected;
  }, [connected]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleFailover = useCallback(() => {
    setLastFailoverAt(Date.now());
    startBurstRefresh();
  }, [startBurstRefresh]);

  const handleEventStart = useCallback((
    type: 'failover' | 'outage',
    label: string,
    currentPrimary: string | null,
  ) => {
    startRecording(type, label, currentPrimary);
  }, [startRecording]);

  const isRunning       = metrics?.workloadStatus === 'running';
  const workloadType    = metrics?.workloadType ?? null;
  const recentFailover  = lastFailoverAt !== null && Date.now() - lastFailoverAt < FAILOVER_RECENT_MS;
  const clusterPaused   = clusterInfo?.paused === true;

  // All electable regions from replicationSpecs, sorted by priority desc (priority 7 = preferred primary).
  const outageRegions = useMemo((): Array<{provider: string; region: string; priority: number; nodeCount: number}> => {
    const specs = clusterInfo?.replicationSpecs as Array<Record<string, unknown>> | undefined;
    if (!specs) return [];
    const regions: Array<{provider: string; region: string; priority: number; nodeCount: number}> = [];
    for (const spec of specs) {
      const rcs = spec.regionConfigs as Array<Record<string, unknown>> | undefined;
      if (!rcs) continue;
      for (const rc of rcs) {
        const electable = rc.electableSpecs as Record<string, unknown> | undefined;
        if (!((electable?.nodeCount as number) > 0)) continue;
        regions.push({
          provider:  (rc.providerName      as string) ?? '',
          region:    (rc.regionName        as string) ?? '',
          priority:  (rc.priority          as number) ?? 0,
          nodeCount: (electable?.nodeCount as number) ?? 0,
        });
      }
    }
    return regions.sort((a, b) => b.priority - a.priority);
  }, [clusterInfo]);

  // Raw cluster-config values — used only for outage simulation API calls (must
  // stay as the cluster's static priority-1 region, not the current primary).
  const rawAtlasProvider = (() => {
    const specs = clusterInfo?.replicationSpecs as Array<Record<string, unknown>> | undefined;
    const rc    = specs?.[0]?.regionConfigs    as Array<Record<string, unknown>> | undefined;
    return (rc?.[0]?.providerName as string | undefined)
      ?? (clusterInfo?.providerSettings as Record<string, unknown> | undefined)?.providerName as string | undefined
      ?? null;
  })();
  const rawAtlasRegion = (() => {
    const specs = clusterInfo?.replicationSpecs as Array<Record<string, unknown>> | undefined;
    const rc    = specs?.[0]?.regionConfigs    as Array<Record<string, unknown>> | undefined;
    return (rc?.[0]?.regionName as string | undefined)
      ?? (clusterInfo?.providerSettings as Record<string, unknown> | undefined)?.regionName as string | undefined
      ?? null;
  })();

  // Header badge: follow the *current* primary's cloud provider/region so it
  // updates live during failover/outage (e.g. AWS → GCP after election).
  // Falls back to the cluster-config region when no primary is known yet.
  const primaryShard = driverPrimary?.match(/shard-\d{2}-\d{2}/)?.[0];
  const primaryRegionInfo = primaryShard ? nodeRegionMap.get(primaryShard) : undefined;
  const liveProvider = (primaryRegionInfo?.provider ?? rawAtlasProvider)?.toLowerCase() ?? null;
  const liveRegion   = (primaryRegionInfo?.region   ?? rawAtlasRegion)?.toLowerCase().replace(/_/g, '-') ?? null;

  return (
    <div className="flex flex-col h-screen bg-[#080809] text-gray-100 overflow-hidden font-sans">

      {/* Ambient radial glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 w-[700px] h-[500px] bg-mdb-green/[0.022] rounded-full blur-[140px]" />
        <div className="absolute top-1/2 -right-40 w-[500px] h-[500px] bg-blue-500/[0.012] rounded-full blur-[120px]" />
      </div>

      {/* ── Header ── */}
      <header className="relative flex items-center justify-between px-4 py-2 bg-[#0c0c10]/90 border-b border-white/[0.06] shrink-0 z-10 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">🍃</span>
          <div>
            <h1 className="text-sm font-semibold font-display text-white leading-tight">
              MongoDB Atlas HA Demo
            </h1>
            <p className="text-xs text-gray-500 leading-tight">
              High Availability &amp; Resilience Blueprint
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {config && (
            <ProviderBadge
              provider={liveProvider ?? config.appCloudProvider}
              region={liveRegion ?? config.appRegion}
              fromAtlas={!!liveProvider}
            />
          )}
          <ConnectionBadge connected={connected} connectionStatus={metrics?.connectionStatus} />
          <button
            onClick={() => setSettingsOpen(true)}
            title="Connection settings"
            className="p-1.5 rounded-lg text-gray-600 hover:text-gray-200 hover:bg-white/[0.06] border border-transparent hover:border-white/[0.08] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.92]"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium font-display ${TOAST_BG[toast.type]}`}>
          {toast.message}
        </div>
      )}

      {/* ── Cluster Paused Banner ── */}
      <ClusterPausedBanner
        paused={clusterPaused}
        controlPlaneEnabled={config?.atlasControlPlaneEnabled ?? false}
        onResume={resumeCluster}
        onToast={showToast}
        onRefreshStart={startBurstRefresh}
      />

      {/* ── Main layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar + collapse tab */}
        <div className="relative flex shrink-0 z-10">
          <aside className={`flex flex-col border-r border-white/[0.06] bg-[#0c0c10] overflow-hidden transition-all duration-200 ease-out ${leftOpen ? 'w-64' : 'w-0'}`}>
            {/* Inner wrapper holds the fixed width so content doesn't reflow */}
            <div className="w-64 flex flex-col flex-1 overflow-y-auto scrollbar-thin">
              <TopologyPanel
                config={config}
                clusterInfo={clusterInfo}
                processes={processes}
                driverPrimary={driverPrimary}
                processesLoading={processesLoading}
                loading={loading}
                error={error}
                onRefresh={refresh}
                onPrimaryChange={startBurstRefresh}
              />
              <div className="border-t border-white/[0.05] flex-1">
                <ScenarioLauncher
                  config={config}
                  onScenarioChange={setActiveScenario}
                  onToast={showToast}
                  onFailover={handleFailover}
                  onEventStart={handleEventStart}
                  currentPrimary={driverPrimary}
                  isRunning={isRunning}
                  workloadType={workloadType}
                  clusterState={clusterInfo?.stateName as string | null | undefined}
                  clusterPaused={clusterPaused}
                  outageRegions={outageRegions}
                  readPref={readPref}
                  onReadPrefChange={setReadPref}
                />
              </div>
            </div>
          </aside>

          {/* Tab sits on the sidebar's right border, protrudes into main */}
          <button
            onClick={() => setLeftOpen(o => !o)}
            title={leftOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full flex items-center justify-center w-4 h-10 bg-[#0c0c10] border-t border-b border-r border-white/[0.08] rounded-r-md text-gray-700 hover:text-gray-200 hover:border-white/[0.20] hover:bg-white/[0.06] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-y-[0.92]"
          >
            {leftOpen
              ? <ChevronLeft  className="w-2.5 h-2.5" />
              : <ChevronRight className="w-2.5 h-2.5" />}
          </button>
        </div>

        {/* Center: terminal + KPIs */}
        <main className="flex flex-col flex-1 overflow-hidden min-w-0 bg-[#080809]">
          <Terminal
            events={terminalEvents}
            csEvents={csEvents}
            onClear={clearTerminal}
            connectionStatus={metrics?.connectionStatus}
          />
          <div className="shrink-0">
            <KPIPanel metrics={metrics} />
          </div>
        </main>

        {/* Right panel + collapse tab */}
        <div className="relative flex shrink-0 z-10">
          {/* Tab sits on the sidebar's left border, protrudes into main */}
          <button
            onClick={() => setRightOpen(o => !o)}
            title={rightOpen ? 'Collapse notes panel' : 'Expand notes panel'}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full flex items-center justify-center w-4 h-10 bg-[#0c0c10] border-t border-b border-l border-white/[0.08] rounded-l-md text-gray-700 hover:text-gray-200 hover:border-white/[0.20] hover:bg-white/[0.06] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-y-[0.92]"
          >
            {rightOpen
              ? <ChevronRight className="w-2.5 h-2.5" />
              : <ChevronLeft  className="w-2.5 h-2.5" />}
          </button>

          <aside className={`flex flex-col border-l border-white/[0.06] bg-[#0c0c10] overflow-hidden transition-all duration-200 ease-out ${rightOpen ? 'w-72' : 'w-0'}`}>
            <div className="w-72 overflow-y-auto scrollbar-thin">
              <ScenarioNotes activeScenario={activeScenario} metrics={metrics} />
            </div>
          </aside>
        </div>
      </div>

      {/* ── Floating HA Explainer ── */}
      <FailoverExplainer
        isRunning={isRunning}
        workloadType={workloadType}
        readPref={readPref}
        processes={processes}
        recentFailover={recentFailover}
      />

      {/* ── HA Report chip — appears after a failover/outage election completes ── */}
      {showReport && record && (
        <div
          className="fixed bottom-[4.5rem] right-4 z-40"
          style={{ animation: 'node-enter 300ms cubic-bezier(0.32,0.72,0,1) both' }}
        >
          <button
            onClick={() => setReportOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold font-display transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.96] hover:-translate-y-px shadow-xl bg-gradient-to-b from-white/[0.11] to-white/[0.04] ring-1 ring-white/[0.12] text-white hover:ring-white/[0.22] shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
          >
            <FileText className="w-3.5 h-3.5 text-mdb-green" />
            View HA Report
            <span className="w-1.5 h-1.5 rounded-full bg-mdb-green animate-pulse-fast" />
          </button>
        </div>
      )}

      {/* ── HA Report Modal ── */}
      {reportOpen && record && (
        <HAReportModal
          record={record}
          onClose={() => { setReportOpen(false); dismissReport(); }}
        />
      )}

      {/* ── Settings Modal ── */}
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
