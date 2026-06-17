import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScenarioNotes from '../components/ScenarioNotes';
import type { MetricsSnapshot } from '@atlas-demo/shared';

function makeMetrics(overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    writesPerSec: 0, readsPerSec: 0, updatesPerSec: 0,
    avgAckLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0,
    errorRate: 0, failedOps: 0, successfulOps: 0, retryCount: 0,
    uptime: 0, workloadStatus: 'idle', workloadType: undefined,
    scenarioId: undefined, connectionStatus: 'connected',
    ...overrides,
  };
}

describe('ScenarioNotes', () => {
  it('shows idle placeholder when no workload is active', () => {
    render(<ScenarioNotes activeScenario={null} metrics={null} />);
    expect(screen.getByText(/no active scenario/i)).toBeInTheDocument();
  });

  it('lists all available scenarios in idle state', () => {
    render(<ScenarioNotes activeScenario={null} metrics={null} />);
    expect(screen.getByText('Write Workload')).toBeInTheDocument();
    expect(screen.getByText('Read Workload')).toBeInTheDocument();
    expect(screen.getByText('Mixed Read/Write')).toBeInTheDocument();
    expect(screen.getByText('Update Workload')).toBeInTheDocument();
    expect(screen.getByText('Bulk Write Workload')).toBeInTheDocument();
  });

  it('shows Read Workload notes when workloadType is read', () => {
    render(
      <ScenarioNotes
        activeScenario="s1"
        metrics={makeMetrics({ workloadType: 'read', workloadStatus: 'running' })}
      />
    );
    expect(screen.getByText('Read Workload')).toBeInTheDocument();
    expect(screen.getByText('Validates')).toBeInTheDocument();
    expect(screen.getByText('Expected Behavior')).toBeInTheDocument();
    expect(screen.getByText('What to Observe')).toBeInTheDocument();
  });

  it('read workload demo tip does NOT claim [S] tags never change (accurate failover description)', () => {
    render(
      <ScenarioNotes
        activeScenario="s1"
        metrics={makeMetrics({ workloadType: 'read', workloadStatus: 'running' })}
      />
    );
    const tipEl = screen.getByText(/switch to secondary/i);
    // Must NOT contain the stale claim we corrected
    expect(tipEl.textContent).not.toMatch(/never change/i);
    // Must contain the accurate description of the secondary→primary edge case
    expect(tipEl.textContent).toMatch(/wins the election/i);
    expect(tipEl.textContent).toMatch(/errors.*0|0.*errors/i);
  });

  it('shows Update Workload notes when workloadType is update', () => {
    render(
      <ScenarioNotes
        activeScenario="s2"
        metrics={makeMetrics({ workloadType: 'update', workloadStatus: 'running' })}
      />
    );
    expect(screen.getByText('Update Workload')).toBeInTheDocument();
  });

  it('shows Live Status section when metrics are provided', () => {
    render(
      <ScenarioNotes
        activeScenario="s1"
        metrics={makeMetrics({ workloadType: 'write', workloadStatus: 'running' })}
      />
    );
    expect(screen.getByText('Live Status')).toBeInTheDocument();
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
  });

  it('shows error rate as 0.0% when no errors', () => {
    render(
      <ScenarioNotes
        activeScenario="s1"
        metrics={makeMetrics({ workloadType: 'write', workloadStatus: 'running', errorRate: 0 })}
      />
    );
    expect(screen.getByText('0.0%')).toBeInTheDocument();
  });

  it('does not show a Scenario ID section (removed as unnecessary noise)', () => {
    render(
      <ScenarioNotes
        activeScenario="my-test-scenario-id"
        metrics={makeMetrics({ workloadType: 'bulk', workloadStatus: 'running' })}
      />
    );
    expect(screen.queryByText('my-test-scenario-id')).not.toBeInTheDocument();
    expect(screen.queryByText(/scenario id/i)).not.toBeInTheDocument();
  });
});
