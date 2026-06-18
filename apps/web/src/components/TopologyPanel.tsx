import { RefreshCw, Database, Network } from 'lucide-react';
import { useMemo } from 'react';
import type { PublicConfig } from '@atlas-demo/shared';
import type { AtlasProcess } from '../hooks/useAtlas';
import TopologyMap from './TopologyMap';

const PROVIDER_CHIP: Record<string, { text: string; dot: string }> = {
  aws:   { text: 'text-orange-400', dot: 'bg-orange-400' },
  gcp:   { text: 'text-blue-400',   dot: 'bg-blue-400'   },
  azure: { text: 'text-sky-400',    dot: 'bg-sky-400'    },
};
const DEFAULT_CHIP = { text: 'text-gray-400', dot: 'bg-gray-600' };

interface Props {
  config:           PublicConfig | null;
  clusterInfo:      Record<string, unknown> | null;
  processes:        AtlasProcess[];
  driverPrimary?:   string | null;
  processesLoading: boolean;
  loading:          boolean;
  error:            string | null;
  onRefresh:        () => void;
  onPrimaryChange?: () => void;
}

function InfoRow({ label, value, mono = false }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex justify-between items-start gap-2 py-1">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className={`text-xs text-right truncate max-w-[130px] ${mono ? 'font-mono text-mdb-green' : 'text-gray-300'}`}>
        {String(value)}
      </span>
    </div>
  );
}

const STATE_COLOR: Record<string, string> = {
  IDLE:      'text-mdb-green',
  CREATING:  'text-yellow-400',
  UPDATING:  'text-yellow-400',
  REPAIRING: 'text-orange-400',
  DELETING:  'text-red-400',
};

// Atlas uses "IDLE" to mean "running normally". Show a friendlier label.
const STATE_LABEL: Record<string, string> = {
  IDLE: 'RUNNING',
};

export default function TopologyPanel({
  config, clusterInfo, processes, driverPrimary, processesLoading, loading, error, onRefresh, onPrimaryChange,
}: Props) {
  const stateName    = (clusterInfo?.stateName    as string) ?? null;
  const mongoVersion = (clusterInfo?.mongoDBVersion as string) ?? null;
  const clusterType  = (clusterInfo?.clusterType  as string) ?? null;
  const stateColor   = STATE_COLOR[stateName ?? ''] ?? 'text-gray-400';

  // Extract electable regions from replicationSpecs, sorted by priority desc.
  // priority 7 = Atlas-preferred primary region.
  const clusterRegions = useMemo((): Array<{ provider: string; region: string; priority: number }> => {
    const specs = clusterInfo?.replicationSpecs as Array<Record<string, unknown>> | undefined;
    if (!specs) return [];
    const out: Array<{ provider: string; region: string; priority: number }> = [];
    for (const spec of specs) {
      const rcs = spec.regionConfigs as Array<Record<string, unknown>> | undefined;
      if (!rcs) continue;
      for (const rc of rcs) {
        const electable = rc.electableSpecs as Record<string, unknown> | undefined;
        if (!((electable?.nodeCount as number) > 0)) continue;
        out.push({
          provider: (rc.providerName as string) ?? '',
          region:   (rc.regionName  as string) ?? '',
          priority: (rc.priority    as number) ?? 0,
        });
      }
    }
    return out.sort((a, b) => b.priority - a.priority);
  }, [clusterInfo]);

  return (
    <div className="p-3 space-y-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-mdb-green" />
          <span className="text-xs font-semibold font-display text-white uppercase tracking-wider">
            Infrastructure
          </span>
        </div>
        <button
          onClick={onRefresh}
          className="text-gray-500 hover:text-mdb-green transition-colors duration-150"
          title="Refresh cluster info"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Static config */}
      <div className="space-y-0.5 border-b border-white/[0.05] pb-2">
        <InfoRow label="Project ID"  value={config?.atlasProjectId}    mono />
        <InfoRow label="Cluster"     value={config?.atlasClusterName} />
        <InfoRow label="Database"    value={config?.mongoDbName}        mono />
        <InfoRow label="Collection"  value={config?.collectionName}     mono />
      </div>

      {/* Live cluster state */}
      {error ? (
        <div className="text-xs text-red-400 bg-red-950/60 border border-red-900/50 rounded p-2">{error}</div>
      ) : loading && !clusterInfo ? (
        <div className="text-xs text-gray-600 animate-pulse">Loading cluster…</div>
      ) : clusterInfo ? (
        <div className="space-y-0.5 border-b border-white/[0.05] pb-2">
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-gray-500">State</span>
            <span className={`text-xs font-semibold font-display ${stateColor}`}>
              {stateName ? (STATE_LABEL[stateName] ?? stateName) : 'UNKNOWN'}
            </span>
          </div>
          <InfoRow label="Type"    value={clusterType} />
          <InfoRow label="Version" value={mongoVersion} />

          {/* Cloud regions derived from replicationSpecs */}
          {clusterRegions.length > 0 && (
            <div className="pt-1 space-y-1">
              {clusterRegions.map(r => {
                const chip = PROVIDER_CHIP[r.provider.toLowerCase()] ?? DEFAULT_CHIP;
                return (
                  <div key={`${r.provider}||${r.region}`} className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${chip.dot}`} />
                    <span className={`text-[9px] font-mono flex-1 ${chip.text}`}>
                      {r.provider} · {r.region.toLowerCase().replace(/_/g, '-')}
                    </span>
                    {r.priority === 7 && (
                      <span className="text-[8px] text-mdb-green font-display font-semibold">★</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* Replica set topology */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Network className="w-3 h-3 text-gray-600" />
          <span className="text-[10px] font-display font-semibold text-gray-500 uppercase tracking-[0.12em]">
            Replica Set
          </span>
        </div>
        <TopologyMap
          processes={processes}
          driverPrimary={driverPrimary}
          loading={processesLoading}
          onPrimaryChange={onPrimaryChange}
        />
      </div>
    </div>
  );
}
