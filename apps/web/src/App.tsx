import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSSE } from './hooks/useSSE';
import { useAtlas } from './hooks/useAtlas';
import TopologyPanel from './components/TopologyPanel';
import ScenarioLauncher from './components/ScenarioLauncher';
import Terminal from './components/Terminal';
import KPIPanel from './components/KPIPanel';
import ScenarioNotes from './components/ScenarioNotes';
import ConnectionBadge from './components/ConnectionBadge';
import ProviderBadge from './components/ProviderBadge';
import FailoverExplainer from './components/FailoverExplainer';

type ToastType = 'success' | 'error' | 'info';
interface Toast { message: string; type: ToastType; }

const TOAST_BG: Record<ToastType, string> = {
  success: 'bg-mdb-green text-black',
  error:   'bg-red-600 text-white',
  info:    'bg-gray-700 text-white',
};

const FAILOVER_RECENT_MS = 5 * 60 * 1000; // 5 min

export default function App() {
  const { connected, terminalEvents, metrics, clearTerminal } = useSSE();
  const { config, clusterInfo, processes, processesLoading, loading, error, refresh, startBurstRefresh } = useAtlas();

  const [activeScenario,   setActiveScenario]   = useState<string | null>(null);
  const [toast,            setToast]            = useState<Toast | null>(null);
  const [readPref,         setReadPref]         = useState<'primary' | 'secondaryPreferred'>('primary');
  const [lastFailoverAt,   setLastFailoverAt]   = useState<number | null>(null);
  const [leftOpen,         setLeftOpen]         = useState(true);
  const [rightOpen,        setRightOpen]        = useState(true);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleFailover = useCallback(() => {
    setLastFailoverAt(Date.now());
    startBurstRefresh();
  }, [startBurstRefresh]);

  const isRunning       = metrics?.workloadStatus === 'running';
  const workloadType    = metrics?.workloadType ?? null;
  const recentFailover  = lastFailoverAt !== null && Date.now() - lastFailoverAt < FAILOVER_RECENT_MS;

  // Derive live provider/region from Atlas API replicationSpecs → providerSettings fallback.
  // Raw values (AWS / US_EAST_1) are used for outage simulation API calls.
  // Display values are lowercased with underscores replaced by hyphens.
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

  const liveProvider = rawAtlasProvider?.toLowerCase() ?? null;
  const liveRegion   = rawAtlasRegion?.toLowerCase().replace(/_/g, '-') ?? null;

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
        </div>
      </header>

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium font-display ${TOAST_BG[toast.type]}`}>
          {toast.message}
        </div>
      )}

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
                  isRunning={isRunning}
                  workloadType={workloadType}
                  clusterState={clusterInfo?.stateName as string | null | undefined}
                  defaultOutageProvider={rawAtlasProvider ?? undefined}
                  defaultOutageRegion={rawAtlasRegion ?? undefined}
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
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full flex items-center justify-center w-4 h-10 bg-[#0c0c10] border-t border-b border-r border-white/[0.08] rounded-r-md text-gray-600 hover:text-gray-200 hover:border-white/[0.18] hover:bg-white/[0.05] transition-all duration-150 active:scale-y-95"
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
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full flex items-center justify-center w-4 h-10 bg-[#0c0c10] border-t border-b border-l border-white/[0.08] rounded-l-md text-gray-600 hover:text-gray-200 hover:border-white/[0.18] hover:bg-white/[0.05] transition-all duration-150 active:scale-y-95"
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
    </div>
  );
}
