import { useState, useCallback } from 'react';
import { useSSE } from './hooks/useSSE';
import { useAtlas } from './hooks/useAtlas';
import TopologyPanel from './components/TopologyPanel';
import ScenarioLauncher from './components/ScenarioLauncher';
import Terminal from './components/Terminal';
import KPIPanel from './components/KPIPanel';
import ScenarioNotes from './components/ScenarioNotes';
import ConnectionBadge from './components/ConnectionBadge';
import ProviderBadge from './components/ProviderBadge';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  message: string;
  type: ToastType;
}

const TOAST_BG: Record<ToastType, string> = {
  success: 'bg-mdb-green text-black',
  error: 'bg-red-600 text-white',
  info: 'bg-gray-700 text-white',
};

export default function App() {
  const { connected, terminalEvents, metrics, clearTerminal } = useSSE();
  const { config, clusterInfo, processes, processesLoading, loading, error, refresh, startBurstRefresh } = useAtlas();

  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const isRunning = metrics?.workloadStatus === 'running';

  // Derive real provider/region from Atlas API. Try replicationSpecs first (multi-region),
  // fall back to top-level providerSettings (single-region dedicated clusters).
  // Atlas regionName is UPPER_SNAKE (EU_SOUTH_2) — convert to standard format (eu-south-2).
  // Raw Atlas values (provider = "AWS", region = "EU_SOUTH_2") for the outage simulation API.
  // Display values (liveProvider = "aws", liveRegion = "eu-south-2") for the header badge.
  const rawAtlasProvider = (() => {
    const specs = clusterInfo?.replicationSpecs as Array<Record<string, unknown>> | undefined;
    const rc = specs?.[0]?.regionConfigs as Array<Record<string, unknown>> | undefined;
    return (rc?.[0]?.providerName as string | undefined)
      ?? (clusterInfo?.providerSettings as Record<string, unknown> | undefined)?.providerName as string | undefined
      ?? null;
  })();
  const rawAtlasRegion = (() => {
    const specs = clusterInfo?.replicationSpecs as Array<Record<string, unknown>> | undefined;
    const rc = specs?.[0]?.regionConfigs as Array<Record<string, unknown>> | undefined;
    return (rc?.[0]?.regionName as string | undefined)
      ?? (clusterInfo?.providerSettings as Record<string, unknown> | undefined)?.regionName as string | undefined
      ?? null;
  })();

  const liveProvider = rawAtlasProvider?.toLowerCase() ?? null;
  const liveRegion   = rawAtlasRegion?.toLowerCase().replace(/_/g, '-') ?? null;

  return (
    <div className="flex flex-col h-screen bg-[#080809] text-gray-100 overflow-hidden font-sans">

      {/* Ambient radial glow — fixed, pointer-events-none, GPU-safe */}
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
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium font-display transition-all ${TOAST_BG[toast.type]}`}
        >
          {toast.message}
        </div>
      )}

      {/* ── Main layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar */}
        <aside className="flex flex-col w-64 shrink-0 border-r border-white/[0.06] bg-[#0c0c10] overflow-y-auto scrollbar-thin">
          <TopologyPanel
            config={config}
            clusterInfo={clusterInfo}
            processes={processes}
            processesLoading={processesLoading}
            loading={loading}
            error={error}
            onRefresh={refresh}
            activeScenario={activeScenario}
            workloadStatus={metrics?.workloadStatus}
          />
          <div className="border-t border-white/[0.05] flex-1">
            <ScenarioLauncher
              config={config}
              onScenarioChange={setActiveScenario}
              onToast={showToast}
              onFailover={startBurstRefresh}
              isRunning={isRunning}
              clusterState={clusterInfo?.stateName as string | null | undefined}
              defaultOutageProvider={rawAtlasProvider ?? undefined}
              defaultOutageRegion={rawAtlasRegion ?? undefined}
            />
          </div>
        </aside>

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

        {/* Right panel: scenario notes */}
        <aside className="w-72 shrink-0 border-l border-white/[0.06] bg-[#0c0c10] overflow-y-auto scrollbar-thin">
          <ScenarioNotes activeScenario={activeScenario} metrics={metrics} />
        </aside>
      </div>
    </div>
  );
}
