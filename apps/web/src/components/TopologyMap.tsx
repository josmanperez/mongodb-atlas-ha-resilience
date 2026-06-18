import { useRef, useEffect, useState } from 'react';
import type { AtlasProcess } from '../hooks/useAtlas';

interface RegionInfo { provider: string; region: string; }

interface Props {
  processes: AtlasProcess[];
  loading: boolean;
  onPrimaryChange?: () => void;
  primaryRegion?: RegionInfo;
  driverPrimary?: string | null;
}

const PROVIDER_CHIP: Record<string, { text: string; dot: string }> = {
  aws:   { text: 'text-orange-400', dot: 'bg-orange-400' },
  gcp:   { text: 'text-blue-400',   dot: 'bg-blue-400'   },
  azure: { text: 'text-sky-400',    dot: 'bg-sky-400'    },
};
const DEFAULT_CHIP = { text: 'text-gray-500', dot: 'bg-gray-600' };

type Role = 'PRIMARY' | 'SECONDARY' | 'RECOVERING' | 'OTHER';

function deriveRole(typeName: string): Role {
  if (typeName.includes('PRIMARY')) return 'PRIMARY';
  if (typeName.includes('SECONDARY')) return 'SECONDARY';
  if (typeName === 'RECOVERING') return 'RECOVERING';
  return 'OTHER';
}

// Driver SDAM is authoritative over the Atlas processes API, which lags 30–120 s
// after elections and outage simulations:
//   • if driver knows the primary and this node IS it → promote to PRIMARY
//     (covers the case where Atlas processes API still says RECOVERING)
//   • if driver knows the primary and this node CLAIMS primary but isn't it →
//     demote to RECOVERING (covers the stale-primary-in-Atlas case)
function resolvedRole(process: AtlasProcess, driverPrimary: string | null | undefined): Role {
  if (driverPrimary) {
    if (process.id === driverPrimary) return 'PRIMARY';
    if (deriveRole(process.typeName) === 'PRIMARY') return 'RECOVERING';
  }
  return deriveRole(process.typeName);
}

// Trim "cluster0-shard-00-00.xxxxx.mongodb.net" → "shard-00-00"
function shortHost(hostname: string): string {
  const parts = hostname.split('.');
  const seg = parts[0] ?? hostname;
  const m = seg.match(/shard-\d{2}-\d{2}$/i);
  return m ? m[0] : seg.slice(-14);
}

const ROLE_STYLE: Record<Role, {
  outer: string;
  inner: string;
  labelColor: string;
  hostColor: string;
  dot: string;
  dotAnim: string;
}> = {
  PRIMARY: {
    outer:      'bg-gradient-to-b from-[#00ed6433] to-[#00ed640a] ring-1 ring-[#00ed6440]',
    inner:      'bg-[#070d08]',
    labelColor: 'text-mdb-green',
    hostColor:  'text-gray-200',
    dot:        'bg-mdb-green',
    dotAnim:    'animate-pulse-fast',
  },
  SECONDARY: {
    outer:      'bg-gradient-to-b from-white/[0.07] to-transparent ring-1 ring-white/[0.06]',
    inner:      'bg-[#0c0c10]',
    labelColor: 'text-gray-400',
    hostColor:  'text-gray-300',
    dot:        'bg-gray-600',
    dotAnim:    '',
  },
  RECOVERING: {
    outer:      'bg-gradient-to-b from-yellow-500/[0.14] to-transparent ring-1 ring-yellow-500/[0.18]',
    inner:      'bg-[#0c0a00]',
    labelColor: 'text-yellow-400',
    hostColor:  'text-yellow-600',
    dot:        'bg-yellow-500',
    dotAnim:    'animate-pulse',
  },
  OTHER: {
    outer:      'bg-gradient-to-b from-white/[0.03] to-transparent ring-1 ring-white/[0.03]',
    inner:      'bg-[#0c0c10]',
    labelColor: 'text-gray-600',
    hostColor:  'text-gray-600',
    dot:        'bg-gray-800',
    dotAnim:    '',
  },
};

function NodeCard({
  process,
  role,
  isNewPrimary,
  enterDelay,
  region,
}: {
  process: AtlasProcess;
  role: Role;
  isNewPrimary: boolean;
  enterDelay: number;
  region?: RegionInfo;
}) {
  const style = ROLE_STYLE[role];
  const host = shortHost(process.hostname);
  const chip = region ? (PROVIDER_CHIP[region.provider.toLowerCase()] ?? DEFAULT_CHIP) : null;

  return (
    <div
      className={`node-enter p-px rounded-xl ${style.outer}`}
      style={{ animationDelay: `${enterDelay}ms` }}
    >
      <div
        className={`${style.inner} rounded-[calc(0.75rem-1px)] px-2.5 py-2 ${isNewPrimary ? 'new-primary-flash' : ''}`}
      >
        <div className="flex items-center justify-between mb-1">
          <span
            className={`text-[9px] font-mono font-semibold uppercase tracking-[0.14em] ${style.labelColor}`}
          >
            {role === 'OTHER' ? process.typeName.replace('REPLICA_SET_', '') : role}
          </span>
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot} ${style.dotAnim}`}
          />
        </div>

        <p className={`text-[10px] font-mono truncate leading-tight ${style.hostColor}`}>
          {host}
        </p>
        {process.version && (
          <p className="text-[9px] text-gray-700 font-mono mt-0.5 leading-none">
            v{process.version}
          </p>
        )}

        {/* Provider + region — shown only on PRIMARY (highest-priority region from Atlas) */}
        {chip && region && (
          <div className={`flex items-center gap-1 mt-1.5 ${chip.text}`}>
            <span className={`w-1 h-1 rounded-full shrink-0 ${chip.dot}`} />
            <span className="text-[8px] font-mono leading-none">
              {region.provider} · {region.region.toLowerCase().replace(/_/g, '-')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SkeletonCard({ delay }: { delay: number }) {
  return (
    <div
      className="node-enter p-px rounded-xl bg-gradient-to-b from-white/[0.04] to-transparent ring-1 ring-white/[0.03] animate-pulse"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="bg-[#0c0c10] rounded-[calc(0.75rem-1px)] px-2.5 py-2">
        <div className="flex items-center justify-between mb-1.5">
          <div className="h-2 w-14 bg-white/[0.05] rounded" />
          <div className="w-1.5 h-1.5 rounded-full bg-white/[0.05]" />
        </div>
        <div className="h-2.5 w-24 bg-white/[0.04] rounded mb-1" />
        <div className="h-2 w-10 bg-white/[0.03] rounded" />
      </div>
    </div>
  );
}

export default function TopologyMap({ processes, loading, onPrimaryChange, primaryRegion, driverPrimary }: Props) {
  const prevPrimaryIdRef = useRef<string | null>(null);
  const [newPrimaryId, setNewPrimaryId] = useState<string | null>(null);

  // Group all processes by replicaSetName; pick the group that has a PRIMARY
  // (i.e., the active shard for this cluster). Multi-cluster projects return
  // processes for every cluster — grouping avoids hostname-prefix guessing.
  const activeNodes = (() => {
    if (processes.length === 0) return [];
    const groups = new Map<string, typeof processes>();
    for (const p of processes) {
      const key = p.replicaSetName ?? 'unknown';
      const g = groups.get(key) ?? [];
      g.push(p);
      groups.set(key, g);
    }
    // Prefer the group containing the driver's live primary; fall back to the
    // group Atlas API calls PRIMARY; then to the largest group.
    if (driverPrimary) {
      for (const group of groups.values()) {
        if (group.some((p) => p.id === driverPrimary)) return group;
      }
    }
    for (const group of groups.values()) {
      if (group.some((p) => deriveRole(p.typeName) === 'PRIMARY')) return group;
    }
    return [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  })();

  const primaryProcess = activeNodes.find((p) => resolvedRole(p, driverPrimary) === 'PRIMARY');

  // Detect primary change → flash the new node + notify parent to burst-refresh.
  useEffect(() => {
    if (!primaryProcess) return;
    if (prevPrimaryIdRef.current && prevPrimaryIdRef.current !== primaryProcess.id) {
      prevPrimaryIdRef.current = primaryProcess.id;
      setNewPrimaryId(primaryProcess.id);
      onPrimaryChange?.();
      const t = setTimeout(() => setNewPrimaryId(null), 2000);
      return () => clearTimeout(t);
    }
    prevPrimaryIdRef.current = primaryProcess.id;
  }, [primaryProcess, onPrimaryChange]);

  // Sort: PRIMARY first, then SECONDARY, then RECOVERING
  const sorted = [...activeNodes].sort((a, b) => {
    const order: Record<Role, number> = { PRIMARY: 0, SECONDARY: 1, RECOVERING: 2, OTHER: 3 };
    return order[resolvedRole(a, driverPrimary)] - order[resolvedRole(b, driverPrimary)];
  });

  const showSkeleton = loading && processes.length === 0;

  return (
    <div className="space-y-1.5">
      {showSkeleton ? (
        <>
          <SkeletonCard delay={0} />
          <SkeletonCard delay={50} />
          <SkeletonCard delay={100} />
        </>
      ) : processes.length === 0 ? (
        <p className="text-[10px] text-gray-700 px-0.5">
          Atlas control plane required
        </p>
      ) : (
        sorted.map((p, i) => {
          const role = resolvedRole(p, driverPrimary);
          return (
            <NodeCard
              key={p.id}
              process={p}
              role={role}
              isNewPrimary={p.id === newPrimaryId}
              enterDelay={i * 50}
              region={role === 'PRIMARY' ? primaryRegion : undefined}
            />
          );
        })
      )}
    </div>
  );
}
