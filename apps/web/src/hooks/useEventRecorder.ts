import { useState, useRef, useCallback, useEffect } from 'react';
import type { MetricsSnapshot } from '@atlas-demo/shared';

export interface MetricSample {
  t: number;   // ms since event start
  p50: number; // ms
  p95: number; // ms
  p99: number; // ms
}

export interface EventNodeSnapshot {
  shard: string;    // e.g. "shard-00-01"
  provider: string; // e.g. "AWS"
  region: string;   // e.g. "EU_SOUTH_2"
}

export interface EventRecord {
  type: 'failover' | 'outage';
  eventLabel: string;
  startTime: number; // epoch ms
  before: EventNodeSnapshot & {
    p50: number;
    p95: number;
    p99: number;
    writesPerSec: number;
  };
  samples: MetricSample[];
  peakP95: number;
  after: EventNodeSnapshot & {
    p50: number;
    p95: number;
    electionMs: number;
  };
}

function extractShard(s: string | null): string {
  if (!s) return 'unknown';
  return s.match(/shard-\d{2}-\d{2}/)?.[0] ?? s.split('.')[0] ?? 'unknown';
}

interface RecorderOptions {
  metrics: MetricsSnapshot | null;
  driverPrimary: string | null;
  nodeRegionMap: Map<string, { provider: string; region: string }>;
}

export function useEventRecorder({ metrics, driverPrimary, nodeRegionMap }: RecorderOptions) {
  const [record, setRecord] = useState<EventRecord | null>(null);
  const [showReport, setShowReport] = useState(false);

  const isRecordingRef = useRef(false);
  const recordingRef = useRef<{
    type: 'failover' | 'outage';
    eventLabel: string;
    startTime: number;
    beforePrimary: string;
    before: EventRecord['before'];
    samples: MetricSample[];
    peakP95: number;
  } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs current so sampling effects always read fresh values
  const metricsRef = useRef<MetricsSnapshot | null>(null);
  const nodeRegionMapRef = useRef(nodeRegionMap);
  useEffect(() => { metricsRef.current = metrics; }, [metrics]);
  useEffect(() => { nodeRegionMapRef.current = nodeRegionMap; }, [nodeRegionMap]);

  // Sample latency on every metrics push while recording
  useEffect(() => {
    if (!isRecordingRef.current || !metrics) return;
    const rec = recordingRef.current;
    if (!rec) return;
    const t = Date.now() - rec.startTime;
    const sample: MetricSample = {
      t,
      p50: metrics.p50LatencyMs ?? 0,
      p95: metrics.p95LatencyMs ?? 0,
      p99: metrics.p99LatencyMs ?? 0,
    };
    rec.samples.push(sample);
    if (sample.p95 > rec.peakP95) rec.peakP95 = sample.p95;
  }, [metrics]);

  // Detect primary change → finalize record
  useEffect(() => {
    if (!isRecordingRef.current || !driverPrimary) return;
    const rec = recordingRef.current;
    if (!rec) return;
    if (driverPrimary === rec.beforePrimary) return;

    isRecordingRef.current = false;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const electionMs = Date.now() - rec.startTime;
    const afterShard = extractShard(driverPrimary);
    const afterRegion = nodeRegionMapRef.current.get(afterShard);
    const m = metricsRef.current;

    const completed: EventRecord = {
      type: rec.type,
      eventLabel: rec.eventLabel,
      startTime: rec.startTime,
      before: rec.before,
      samples: rec.samples,
      peakP95: rec.peakP95,
      after: {
        shard: afterShard,
        provider: afterRegion?.provider ?? 'UNKNOWN',
        region: afterRegion?.region ?? 'UNKNOWN',
        p50: m?.p50LatencyMs ?? 0,
        p95: m?.p95LatencyMs ?? 0,
        electionMs,
      },
    };

    recordingRef.current = null;
    setRecord(completed);
    setShowReport(true);
  }, [driverPrimary]);

  const startRecording = useCallback((
    type: 'failover' | 'outage',
    eventLabel: string,
    currentPrimary: string | null,
  ) => {
    const currentMetrics = metricsRef.current;
    const currentMap = nodeRegionMapRef.current;

    const beforeShard = extractShard(currentPrimary);
    const beforeRegion = currentMap.get(beforeShard);

    recordingRef.current = {
      type,
      eventLabel,
      startTime: Date.now(),
      beforePrimary: currentPrimary ?? '',
      before: {
        shard: beforeShard,
        provider: beforeRegion?.provider ?? 'UNKNOWN',
        region: beforeRegion?.region ?? 'UNKNOWN',
        p50: currentMetrics?.p50LatencyMs ?? 0,
        p95: currentMetrics?.p95LatencyMs ?? 0,
        p99: currentMetrics?.p99LatencyMs ?? 0,
        writesPerSec: currentMetrics?.writesPerSec ?? 0,
      },
      samples: [],
      peakP95: 0,
    };

    isRecordingRef.current = true;
    setRecord(null);
    setShowReport(false);

    // Safety valve: stop recording after 120 s if no primary change detected
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      isRecordingRef.current = false;
      recordingRef.current = null;
    }, 120_000);
  }, []);

  const dismissReport = useCallback(() => setShowReport(false), []);
  const reopenReport = useCallback(() => { if (record) setShowReport(true); }, [record]);

  return { startRecording, showReport, record, dismissReport, reopenReport };
}
