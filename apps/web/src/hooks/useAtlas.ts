import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from '../api/client';
import type { PublicConfig } from '@atlas-demo/shared';

export interface AtlasProcess {
  id: string;
  hostname: string;
  userAlias?: string;
  port: number;
  typeName: string;
  version: string;
  replicaSetName?: string;
  isDriverPrimary?: boolean;
}

interface AtlasState {
  config: PublicConfig | null;
  clusterInfo: Record<string, unknown> | null;
  processes: AtlasProcess[];
  driverPrimary: string | null;
  processesLoading: boolean;
  loading: boolean;
  error: string | null;
}

const NORMAL_INTERVAL = 30_000;
const BURST_INTERVAL  = 3_000;
const BURST_DURATION  = 90_000;

export function useAtlas() {
  const [state, setState] = useState<AtlasState>({
    config: null,
    clusterInfo: null,
    processes: [],
    driverPrimary: null,
    processesLoading: true,
    loading: true,
    error: null,
  });

  const processTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clusterBurstRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const burstTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchConfig = useCallback(async () => {
    const res = await api.publicConfig();
    if (res.success && res.data) {
      setState((s) => ({ ...s, config: res.data! }));
    }
  }, []);

  const fetchCluster = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const res = await api.cluster();
    if (res.success && res.data) {
      setState((s) => ({ ...s, clusterInfo: res.data!, loading: false }));
    } else {
      setState((s) => ({
        ...s,
        error: res.error ?? 'Failed to fetch cluster info',
        loading: false,
      }));
    }
  }, []);

  const fetchProcesses = useCallback(async () => {
    const res = await api.processes();
    if (res.success) {
      setState((s) => ({
        ...s,
        processes: (res.data ?? []) as unknown as AtlasProcess[],
        driverPrimary: res.driverPrimary ?? null,
        processesLoading: false,
      }));
    } else {
      setState((s) => ({ ...s, processesLoading: false }));
    }
  }, []);

  const scheduleProcess = useCallback((ms: number) => {
    if (processTimerRef.current) clearInterval(processTimerRef.current);
    processTimerRef.current = setInterval(fetchProcesses, ms);
  }, [fetchProcesses]);

  const startBurstRefresh = useCallback(() => {
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current);

    // Burst-poll both processes (3 s) and cluster state (5 s) for 90 s after failover
    fetchProcesses();
    fetchCluster();
    scheduleProcess(BURST_INTERVAL);

    if (clusterBurstRef.current) clearInterval(clusterBurstRef.current);
    clusterBurstRef.current = setInterval(fetchCluster, 5_000);

    burstTimerRef.current = setTimeout(() => {
      scheduleProcess(NORMAL_INTERVAL);
      if (clusterBurstRef.current) {
        clearInterval(clusterBurstRef.current);
        clusterBurstRef.current = null;
      }
    }, BURST_DURATION);
  }, [fetchProcesses, fetchCluster, scheduleProcess]);

  useEffect(() => {
    fetchConfig();
    fetchCluster();
    fetchProcesses();
    const clusterTimer = setInterval(fetchCluster, NORMAL_INTERVAL);
    scheduleProcess(NORMAL_INTERVAL);
    return () => {
      clearInterval(clusterTimer);
      if (processTimerRef.current) clearInterval(processTimerRef.current);
      if (clusterBurstRef.current) clearInterval(clusterBurstRef.current);
      if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    };
  }, [fetchConfig, fetchCluster, fetchProcesses, scheduleProcess]);

  const resumeCluster = useCallback(async () => {
    const res = await api.resumeCluster();
    if (res.success) {
      // Cluster takes ~2 min to wake; start polling every 5 s so the banner
      // disappears automatically once paused flips to false.
      startBurstRefresh();
    }
    return res;
  }, [startBurstRefresh]);

  // Derives shard-id → { provider, region } using the same inference as the
  // backend's buildNodeRegionMap: Atlas assigns shard numbers sequentially by
  // region in priority order (priority-7 region first), matching the sorted
  // process list (alphabetical by hostname = ascending shard number).
  const nodeRegionMap = useMemo((): Map<string, { provider: string; region: string }> => {
    if (!state.clusterInfo || state.processes.length === 0) return new Map();
    const specs = state.clusterInfo['replicationSpecs'] as Array<Record<string, unknown>> | undefined;
    if (!specs) return new Map();
    const regions: Array<{ provider: string; region: string; priority: number; nodeCount: number }> = [];
    for (const spec of specs) {
      const rcs = spec['regionConfigs'] as Array<Record<string, unknown>> | undefined;
      if (!rcs) continue;
      for (const rc of rcs) {
        const electable = rc['electableSpecs'] as Record<string, unknown> | undefined;
        const nodeCount = (electable?.['nodeCount'] as number) ?? 0;
        if (nodeCount > 0) {
          regions.push({
            provider: (rc['providerName'] as string) ?? '',
            region:   (rc['regionName']   as string) ?? '',
            priority: (rc['priority']     as number) ?? 0,
            nodeCount,
          });
        }
      }
    }
    regions.sort((a, b) => b.priority - a.priority);
    const slots: Array<{ provider: string; region: string }> = [];
    for (const r of regions) {
      for (let i = 0; i < r.nodeCount; i++) slots.push({ provider: r.provider, region: r.region });
    }
    const sorted = [...state.processes].sort((a, b) =>
      (a.userAlias ?? a.hostname).localeCompare(b.userAlias ?? b.hostname)
    );
    const map = new Map<string, { provider: string; region: string }>();
    sorted.forEach((proc, idx) => {
      const shardId = (proc.userAlias ?? proc.hostname).match(/shard-\d{2}-\d{2}/)?.[0];
      if (shardId && slots[idx]) map.set(shardId, slots[idx]);
    });
    return map;
  }, [state.clusterInfo, state.processes]);

  return { ...state, refresh: fetchCluster, startBurstRefresh, resumeCluster, nodeRegionMap };
}
