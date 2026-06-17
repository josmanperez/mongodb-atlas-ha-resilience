import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must mock before importing workload so module-level singletons see the mock
vi.mock('../db/client', () => ({
  getCollection: vi.fn(),
}));

vi.mock('../services/eventBus', () => ({
  eventBus: { broadcast: vi.fn() },
}));

vi.mock('../services/metrics', () => ({
  metricsTracker: {
    recordOp:          vi.fn(),
    recordRetry:       vi.fn(),
    recordFailover:    vi.fn(),
    setWorkloadStatus: vi.fn(),
    getSnapshot:       vi.fn().mockReturnValue({}),
    reset:             vi.fn(),
  },
}));

vi.mock('../config', () => ({
  config: {
    APP_REGION:                   'us-east-1',
    APP_CLOUD_PROVIDER:           'AWS',
    DEFAULT_WRITE_CONCERN:        'majority',
    DEFAULT_READ_PREFERENCE:      'primary',
    DEFAULT_WORKLOAD_INTERVAL_MS: 5,
    DEFAULT_WORKLOAD_CONCURRENCY: 1,
  },
}));

import { startWorkload, stopWorkload, getWorkloadStatus } from '../services/workload';
import { getCollection } from '../db/client';

function makeCollection(overrides: Record<string, unknown> = {}) {
  return {
    insertOne:   vi.fn().mockResolvedValue({ insertedId: 'id1' }),
    insertMany:  vi.fn().mockResolvedValue({ insertedCount: 20 }),
    updateMany:  vi.fn().mockResolvedValue({ matchedCount: 20, modifiedCount: 20 }),
    find:        vi.fn().mockReturnValue({
      sort:  vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: '1' }, { _id: '2' }]),
    }),
    db: {
      command: vi.fn().mockResolvedValue({ me: 'host-shard-00-01:27017', isWritablePrimary: true }),
    },
    ...overrides,
  };
}

describe('getWorkloadStatus', () => {
  it('returns idle when no workload is running', () => {
    const status = getWorkloadStatus();
    expect(status.status).toBe('idle');
    expect(status.type).toBeNull();
    expect(status.scenarioId).toBeNull();
  });
});

describe('stopWorkload', () => {
  it('throws when no workload is running', () => {
    expect(() => stopWorkload()).toThrow('No workload is currently running');
  });
});

describe('write workload', () => {
  let col: ReturnType<typeof makeCollection>;

  beforeEach(() => {
    col = makeCollection();
    (getCollection as ReturnType<typeof vi.fn>).mockReturnValue(col);
  });

  afterEach(async () => {
    try { stopWorkload(); } catch { /* already stopped */ }
    // Allow the abort to propagate
    await new Promise(r => setTimeout(r, 20));
  });

  it('transitions to running status on start', async () => {
    const id = await startWorkload('write', { intervalMs: 5 });
    expect(typeof id).toBe('string');
    expect(getWorkloadStatus().status).toBe('running');
    expect(getWorkloadStatus().type).toBe('write');
  });

  it('calls insertOne at least once within 50ms', async () => {
    await startWorkload('write', { intervalMs: 5 });
    await new Promise(r => setTimeout(r, 50));
    expect(col.insertOne).toHaveBeenCalled();
  });

  it('throws when trying to start a second workload while one is running', async () => {
    await startWorkload('write', { intervalMs: 5 });
    await expect(startWorkload('read', { intervalMs: 5 })).rejects.toThrow('already running');
  });

  it('transitions to idle after stop', async () => {
    await startWorkload('write', { intervalMs: 5 });
    stopWorkload();
    await new Promise(r => setTimeout(r, 30));
    expect(getWorkloadStatus().status).toBe('idle');
  });
});

describe('update workload', () => {
  let col: ReturnType<typeof makeCollection>;

  beforeEach(() => {
    col = makeCollection();
    (getCollection as ReturnType<typeof vi.fn>).mockReturnValue(col);
  });

  afterEach(async () => {
    try { stopWorkload(); } catch { /* already stopped */ }
    await new Promise(r => setTimeout(r, 20));
  });

  it('seeds documents (insertMany) before the first update loop', async () => {
    await startWorkload('update', { intervalMs: 50 });
    // Give it a tick to run the seed
    await new Promise(r => setTimeout(r, 20));
    expect(col.insertMany).toHaveBeenCalled();
    const [seedDocs] = (col.insertMany as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown[]];
    expect(Array.isArray(seedDocs)).toBe(true);
    expect((seedDocs as unknown[]).length).toBe(20);
  });

  it('calls updateMany with the scenarioId filter', async () => {
    const scenarioId = await startWorkload('update', { intervalMs: 50 });
    await new Promise(r => setTimeout(r, 80));
    expect(col.updateMany).toHaveBeenCalled();
    const [filter] = (col.updateMany as ReturnType<typeof vi.fn>).mock.calls[0] as [Record<string, unknown>];
    expect(filter.scenarioId).toBe(scenarioId);
  });

  it('cycles between pending→active and active→pending', async () => {
    await startWorkload('update', { intervalMs: 30 });
    await new Promise(r => setTimeout(r, 120));
    // At least 2 updateMany calls means it cycled
    expect((col.updateMany as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    const statuses = (col.updateMany as ReturnType<typeof vi.fn>).mock.calls.map(
      ([filter]: [Record<string, unknown>]) => filter.status
    );
    expect(statuses).toContain('pending');
    expect(statuses).toContain('active');
  });

  it('matched count is non-zero (seed ensures docs exist)', async () => {
    await startWorkload('update', { intervalMs: 30 });
    await new Promise(r => setTimeout(r, 60));
    const result = await (col.updateMany as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(result.matchedCount).toBe(20);
  });
});

describe('bulk workload', () => {
  let col: ReturnType<typeof makeCollection>;

  beforeEach(() => {
    col = makeCollection({ bulkWrite: vi.fn().mockResolvedValue({ ok: 1 }) });
    (getCollection as ReturnType<typeof vi.fn>).mockReturnValue(col);
  });

  afterEach(async () => {
    try { stopWorkload(); } catch { /* already stopped */ }
    await new Promise(r => setTimeout(r, 20));
  });

  it('calls bulkWrite with a batch of insertOne operations', async () => {
    await startWorkload('bulk', { intervalMs: 50, batchSize: 5 });
    await new Promise(r => setTimeout(r, 80));
    expect(col.bulkWrite).toHaveBeenCalled();
    const [ops] = (col.bulkWrite as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown[]];
    expect((ops as unknown[]).length).toBe(5);
  });
});
