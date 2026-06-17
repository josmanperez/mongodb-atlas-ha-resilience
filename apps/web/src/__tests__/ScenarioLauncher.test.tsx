import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ScenarioLauncher from '../components/ScenarioLauncher';

// Mock the API client so tests never hit the network
vi.mock('../api/client', () => ({
  api: {
    startWriteWorkload:  vi.fn(),
    startReadWorkload:   vi.fn(),
    startUpdateWorkload: vi.fn(),
    startMixedWorkload:  vi.fn(),
    startBulkWorkload:   vi.fn(),
    stopWorkload:        vi.fn(),
    triggerFailover:     vi.fn(),
    startOutage:         vi.fn(),
    endOutage:           vi.fn(),
    resetDemo:           vi.fn(),
  },
}));

// Import after mock so vi.mocked() resolves correctly
import { api } from '../api/client';

const defaultProps = {
  config: null,
  onScenarioChange: vi.fn(),
  onToast: vi.fn(),
  onFailover: vi.fn(),
  isRunning: false,
  workloadType: null,
  clusterState: 'IDLE',
  readPref: 'primary' as const,
  onReadPrefChange: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Re-set default implementations after clearAllMocks (which does NOT reset implementations,
  // so any test that called mockImplementation would bleed into subsequent tests otherwise).
  vi.mocked(api.startWriteWorkload).mockResolvedValue({ success: true, data: { scenarioId: 'test-id', type: 'write' } });
  vi.mocked(api.startReadWorkload).mockResolvedValue({ success: true, data: { scenarioId: 'test-id', type: 'read' } });
  vi.mocked(api.startUpdateWorkload).mockResolvedValue({ success: true, data: { scenarioId: 'test-id', type: 'update' } });
  vi.mocked(api.startMixedWorkload).mockResolvedValue({ success: true, data: { scenarioId: 'test-id', type: 'mixed' } });
  vi.mocked(api.startBulkWorkload).mockResolvedValue({ success: true, data: { scenarioId: 'test-id', type: 'bulk' } });
  vi.mocked(api.stopWorkload).mockResolvedValue({ success: true });
  vi.mocked(api.triggerFailover).mockResolvedValue({ success: true });
  vi.mocked(api.resetDemo).mockResolvedValue({ success: true, data: { deleted: 0 } });
});

describe('ScenarioLauncher', () => {
  it('renders all five workload buttons when idle', () => {
    render(<ScenarioLauncher {...defaultProps} />);
    expect(screen.getByText('Write Workload')).toBeInTheDocument();
    expect(screen.getByText('Read Workload')).toBeInTheDocument();
    expect(screen.getByText('Mixed Read/Write')).toBeInTheDocument();
    expect(screen.getByText('Update Workload')).toBeInTheDocument();
    expect(screen.getByText('Bulk Write')).toBeInTheDocument();
  });

  it('shows LIVE banner when isRunning=true', () => {
    render(<ScenarioLauncher {...defaultProps} isRunning workloadType="read" />);
    expect(screen.getByText(/read running/i)).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('hides LIVE banner immediately when stop is clicked (optimistic update)', async () => {
    // Make stop slow so we can observe the optimistic state before it resolves
    vi.mocked(api.stopWorkload).mockImplementationOnce(
      () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 200))
    );

    render(<ScenarioLauncher {...defaultProps} isRunning workloadType="read" />);
    expect(screen.getByText(/read running/i)).toBeInTheDocument();

    const stopBtn = screen.getByTitle('Stop workload');
    await act(async () => { fireEvent.click(stopBtn); });

    // Banner is gone immediately — before the 200ms API call resolves
    expect(screen.queryByText(/read running/i)).not.toBeInTheDocument();
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  });

  it('shows LIVE banner for new workload after a full stop-and-restart cycle', async () => {
    const { rerender } = render(
      <ScenarioLauncher {...defaultProps} isRunning workloadType="read" />
    );

    // Step 1: click stop → optimistic clear
    const stopBtn = screen.getByTitle('Stop workload');
    await act(async () => { fireEvent.click(stopBtn); });
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();

    // Step 2: SSE confirms workload has stopped
    rerender(<ScenarioLauncher {...defaultProps} isRunning={false} workloadType={null} />);

    // Step 3: user starts a new workload
    await act(async () => { fireEvent.click(screen.getByText('Update Workload')); });
    expect(api.startUpdateWorkload).toHaveBeenCalledOnce();

    // Step 4: SSE confirms the new workload is live
    rerender(<ScenarioLauncher {...defaultProps} isRunning workloadType="update" />);
    expect(screen.getByText(/update running/i)).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('disables other workload buttons when one is running', () => {
    render(<ScenarioLauncher {...defaultProps} isRunning workloadType="write" />);
    const readBtn = screen.getByText('Read Workload').closest('button');
    expect(readBtn).toBeDisabled();
  });

  it('read routing toggle is disabled when workload is running', () => {
    render(<ScenarioLauncher {...defaultProps} isRunning workloadType="read" />);
    const primaryBtn = screen.getByText('Primary').closest('button');
    expect(primaryBtn).toBeDisabled();
  });

  it('calls onReadPrefChange when routing toggle is clicked while idle', () => {
    const onReadPrefChange = vi.fn();
    render(<ScenarioLauncher {...defaultProps} onReadPrefChange={onReadPrefChange} />);
    fireEvent.click(screen.getByText('Secondary ✦'));
    expect(onReadPrefChange).toHaveBeenCalledWith('secondaryPreferred');
  });

  it('calls onScenarioChange(null) after stop succeeds', async () => {
    const onScenarioChange = vi.fn();
    render(
      <ScenarioLauncher {...defaultProps} isRunning workloadType="write" onScenarioChange={onScenarioChange} />
    );
    const stopBtn = screen.getByTitle('Stop workload');
    await act(async () => { fireEvent.click(stopBtn); });
    await waitFor(() => expect(onScenarioChange).toHaveBeenCalledWith(null));
  });
});
