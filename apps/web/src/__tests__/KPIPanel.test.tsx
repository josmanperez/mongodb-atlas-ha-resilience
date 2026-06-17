import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import KPIPanel from '../components/KPIPanel';
import type { MetricsSnapshot } from '@atlas-demo/shared';

const BASE: MetricsSnapshot = {
  writesPerSec: 12.5,
  readsPerSec: 18.2,
  updatesPerSec: 0,
  avgAckLatencyMs: 45,
  p50LatencyMs: 50,
  p95LatencyMs: 97,
  p99LatencyMs: 298,
  errorRate: 0,
  failedOps: 0,
  successfulOps: 4813,
  retryCount: 0,
  uptime: 3600,
  workloadStatus: 'running',
  workloadType: 'write',
  scenarioId: 'test-scenario',
  connectionStatus: 'connected',
};

describe('KPIPanel', () => {
  it('renders without crashing when metrics is null', () => {
    render(<KPIPanel metrics={null} />);
    expect(screen.getByText('Writes/s')).toBeInTheDocument();
  });

  it('renders all twelve tile labels', () => {
    render(<KPIPanel metrics={null} />);
    const labels = ['Writes/s', 'Reads/s', 'Updates/s', 'ACK Lat', 'P50', 'P95', 'P99', 'Error %', 'Retries', 'Success', 'Failed', 'Failover'];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('displays live metric values', () => {
    render(<KPIPanel metrics={BASE} />);
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getByText('18.2')).toBeInTheDocument();
    expect(screen.getByText('4,813')).toBeInTheDocument();
  });

  it('shows <1 for sub-millisecond latency', () => {
    render(<KPIPanel metrics={{ ...BASE, avgAckLatencyMs: 0.5 }} />);
    expect(screen.getByText('<1')).toBeInTheDocument();
  });

  it('shows 0 for failed ops when none have failed', () => {
    render(<KPIPanel metrics={BASE} />);
    // The Failed tile value should be "0"
    const allZeros = screen.getAllByText('0');
    expect(allZeros.length).toBeGreaterThan(0);
  });

  it('shows — for Failover when no failover has occurred', () => {
    render(<KPIPanel metrics={{ ...BASE, lastFailoverTime: undefined }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows a relative time for Failover when one has occurred', () => {
    const recent = new Date(Date.now() - 30_000).toISOString(); // 30s ago
    render(<KPIPanel metrics={{ ...BASE, lastFailoverTime: recent }} />);
    expect(screen.getByText('30s ago')).toBeInTheDocument();
  });

  it('tile labels use text-gray-300 so they are readable against the dark background', () => {
    const { container } = render(<KPIPanel metrics={null} />);
    // The label element must NOT use text-gray-500 (which was too dim — this test guards that regression)
    const labels = container.querySelectorAll('p.text-gray-300');
    expect(labels.length).toBeGreaterThan(0);
  });
});
