import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';
import type { PublicConfig } from '@atlas-demo/shared';

export interface AtlasProcess {
  id: string;
  hostname: string;
  port: number;
  typeName: string;
  version: string;
  replicaSetName?: string;
}

interface AtlasState {
  config: PublicConfig | null;
  clusterInfo: Record<string, unknown> | null;
  processes: AtlasProcess[];
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
      setState((s) => ({ ...s, processes: (res.data ?? []) as unknown as AtlasProcess[], processesLoading: false }));
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

  return { ...state, refresh: fetchCluster, startBurstRefresh };
}
