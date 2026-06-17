import { v4 as uuidv4 } from 'uuid';
import type { W } from 'mongodb';
import { ReadPreference } from 'mongodb';
import type { WorkloadConfig, WorkloadType, TerminalEvent } from '@atlas-demo/shared';
import { getCollection } from '../db/client';
import { config } from '../config';
import { metricsTracker } from './metrics';
import { eventBus } from './eventBus';

function wc(cfg: WorkloadConfig): { writeConcern: { w: W } } {
  return { writeConcern: { w: (cfg.writeConcern ?? config.DEFAULT_WRITE_CONCERN) as W } };
}

let abortController: AbortController | null = null;
let currentScenarioId: string | null = null;
let currentWorkloadType: WorkloadType | null = null;
let sequence = 0;

function emit(event: Omit<TerminalEvent, 'id' | 'timestamp'>): void {
  eventBus.broadcast({
    type: 'terminal',
    payload: {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...event,
    } as TerminalEvent,
    timestamp: new Date().toISOString(),
  });
}

function emitMetrics(): void {
  eventBus.broadcast({
    type: 'metrics',
    payload: metricsTracker.getSnapshot(),
    timestamp: new Date().toISOString(),
  });
}

function buildDoc(scenarioId: string, opId: string, opType: string) {
  const now = new Date();
  sequence += 1;
  return {
    scenarioId,
    operationId: opId,
    operationType: opType,
    appCloudProvider: config.APP_CLOUD_PROVIDER,
    appRegion: config.APP_REGION,
    payload: {
      value: Math.random() * 1000,
      label: `demo-${sequence}`,
    },
    createdAt: now,
    updatedAt: now,
    sequence,
    status: 'pending',
    metadata: { driver: 'node', driverVersion: '6.x' },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

async function runWriteLoop(scenarioId: string, cfg: WorkloadConfig, signal: AbortSignal): Promise<void> {
  const collection = getCollection();
  const writeConcernOpts = wc(cfg);
  const interval = cfg.intervalMs ?? config.DEFAULT_WORKLOAD_INTERVAL_MS;

  while (!signal.aborted) {
    const opId = uuidv4();
    const doc = buildDoc(scenarioId, opId, 'write');
    const start = Date.now();
    try {
      const result = await collection.insertOne(doc, writeConcernOpts);
      const latencyMs = Date.now() - start;
      metricsTracker.recordOp('write', latencyMs, true);
      emit({
        type: 'write',
        status: 'success',
        message: `INSERT acknowledged seq=${doc.sequence}`,
        latencyMs,
        documentId: result.insertedId.toString(),
        region: config.APP_REGION,
      });
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      metricsTracker.recordOp('write', latencyMs, false);
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', status: 'failure', message: `INSERT failed: ${msg}`, latencyMs, region: config.APP_REGION });
    }
    emitMetrics();
    await sleep(interval, signal);
  }
}

async function runReadLoop(_scenarioId: string, cfg: WorkloadConfig, signal: AbortSignal): Promise<void> {
  const collection = getCollection();
  const rp = ReadPreference.fromString(cfg.readPreference ?? config.DEFAULT_READ_PREFERENCE);
  const interval = cfg.intervalMs ?? config.DEFAULT_WORKLOAD_INTERVAL_MS;
  let serverNote = '';
  let iteration = 0;

  while (!signal.aborted) {
    const start = Date.now();
    try {
      // Every 5th iteration, probe which physical node is serving reads (runs in parallel
      // with the find so it doesn't inflate latencyMs). Shows Primary vs Secondary routing.
      const probePromise = iteration % 5 === 0
        ? collection.db.command({ hello: 1 }, { readPreference: rp }).catch(() => null)
        : Promise.resolve(null);

      const docs = await collection
        .find({}, { readPreference: rp })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
      const latencyMs = Date.now() - start;
      metricsTracker.recordOp('read', latencyMs, true);

      const hello = await probePromise;
      if (hello) {
        const me = (hello.me as string | undefined) ?? '';
        const shard = me.match(/shard-\d{2}-\d{2}/)?.[0] ?? me.split(':')[0]?.split('.')[0] ?? '?';
        const role = (hello.isWritablePrimary === true || hello.ismaster === true) ? 'P' : 'S';
        serverNote = ` id=${shard}[${role}]`;
      }

      emit({
        type: 'read',
        status: 'success',
        message: `FIND ${docs.length} docs${serverNote}`,
        latencyMs,
        region: config.APP_REGION,
      });
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      metricsTracker.recordOp('read', latencyMs, false);
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', status: 'failure', message: `FIND failed: ${msg}`, latencyMs, region: config.APP_REGION });
    }
    iteration++;
    emitMetrics();
    await sleep(interval, signal);
  }
}

async function runUpdateLoop(scenarioId: string, cfg: WorkloadConfig, signal: AbortSignal): Promise<void> {
  const collection = getCollection();
  const writeConcernOpts = wc(cfg);
  const interval = cfg.intervalMs ?? config.DEFAULT_WORKLOAD_INTERVAL_MS;

  // Seed initial documents so the update loop has something to work with
  const SEED_SIZE = 20;
  const seed = Array.from({ length: SEED_SIZE }, () => buildDoc(scenarioId, uuidv4(), 'update'));
  await collection.insertMany(seed, { ordered: false, ...writeConcernOpts });

  // Cycle: pending→active then active→pending so matched/modified are always >0
  let fromStatus = 'pending';
  let toStatus   = 'active';

  while (!signal.aborted) {
    const start = Date.now();
    try {
      const result = await collection.updateMany(
        { scenarioId, status: fromStatus },
        { $set: { status: toStatus, updatedAt: new Date() } },
        writeConcernOpts
      );

      // If nothing matched (docs got cleaned up), reseed
      if (result.matchedCount === 0) {
        const reseed = Array.from({ length: SEED_SIZE }, () => buildDoc(scenarioId, uuidv4(), 'update'));
        await collection.insertMany(reseed, { ordered: false, ...writeConcernOpts });
        fromStatus = 'pending';
        toStatus   = 'active';
      } else {
        [fromStatus, toStatus] = [toStatus, fromStatus]; // flip for next iteration
      }

      const latencyMs = Date.now() - start;
      metricsTracker.recordOp('update', latencyMs, true);
      emit({
        type: 'update',
        status: 'success',
        message: `UPDATE ${fromStatus === 'pending' ? 'active→pending' : 'pending→active'} matched=${result.matchedCount} modified=${result.modifiedCount}`,
        latencyMs,
        region: config.APP_REGION,
      });
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      metricsTracker.recordOp('update', latencyMs, false);
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', status: 'failure', message: `UPDATE failed: ${msg}`, latencyMs, region: config.APP_REGION });
    }
    emitMetrics();
    await sleep(interval, signal);
  }
}

async function runMixedLoop(scenarioId: string, cfg: WorkloadConfig, signal: AbortSignal): Promise<void> {
  const ratio = cfg.readWriteRatio ?? 0.5;
  const interval = cfg.intervalMs ?? config.DEFAULT_WORKLOAD_INTERVAL_MS;
  const collection = getCollection();
  const writeConcernOpts = wc(cfg);
  const rp = ReadPreference.fromString(cfg.readPreference ?? config.DEFAULT_READ_PREFERENCE);

  while (!signal.aborted) {
    const roll = Math.random();
    const start = Date.now();

    if (roll < ratio) {
      // Write
      const opId = uuidv4();
      const doc = buildDoc(scenarioId, opId, 'write');
      try {
        const result = await collection.insertOne(doc, writeConcernOpts);
        const latencyMs = Date.now() - start;
        metricsTracker.recordOp('write', latencyMs, true);
        emit({ type: 'write', status: 'success', message: `MIXED INSERT ok seq=${doc.sequence}`, latencyMs, documentId: result.insertedId.toString(), region: config.APP_REGION });
      } catch (err: unknown) {
        const latencyMs = Date.now() - start;
        metricsTracker.recordOp('write', latencyMs, false);
        emit({ type: 'error', status: 'failure', message: `MIXED INSERT failed: ${err instanceof Error ? err.message : String(err)}`, latencyMs, region: config.APP_REGION });
      }
    } else if (roll < ratio + (1 - ratio) / 2) {
      // Read
      try {
        const docs = await collection.find({ scenarioId }, { readPreference: rp }).limit(5).toArray();
        const latencyMs = Date.now() - start;
        metricsTracker.recordOp('read', latencyMs, true);
        emit({ type: 'read', status: 'success', message: `MIXED FIND ${docs.length} docs`, latencyMs, region: config.APP_REGION });
      } catch (err: unknown) {
        const latencyMs = Date.now() - start;
        metricsTracker.recordOp('read', latencyMs, false);
        emit({ type: 'error', status: 'failure', message: `MIXED FIND failed: ${err instanceof Error ? err.message : String(err)}`, latencyMs, region: config.APP_REGION });
      }
    } else {
      // Update
      try {
        const result = await collection.updateOne(
          { scenarioId },
          { $set: { status: 'mixed', updatedAt: new Date() } },
          writeConcernOpts
        );
        const latencyMs = Date.now() - start;
        metricsTracker.recordOp('update', latencyMs, true);
        emit({ type: 'update', status: 'success', message: `MIXED UPDATE modified=${result.modifiedCount}`, latencyMs, region: config.APP_REGION });
      } catch (err: unknown) {
        const latencyMs = Date.now() - start;
        metricsTracker.recordOp('update', latencyMs, false);
        emit({ type: 'error', status: 'failure', message: `MIXED UPDATE failed: ${err instanceof Error ? err.message : String(err)}`, latencyMs, region: config.APP_REGION });
      }
    }

    emitMetrics();
    await sleep(interval, signal);
  }
}

async function runBulkLoop(scenarioId: string, cfg: WorkloadConfig, signal: AbortSignal): Promise<void> {
  const collection = getCollection();
  const writeConcernOpts = wc(cfg);
  const batchSize = cfg.batchSize ?? 20;
  const interval = cfg.intervalMs ?? config.DEFAULT_WORKLOAD_INTERVAL_MS;

  while (!signal.aborted) {
    const start = Date.now();
    try {
      const ops = Array.from({ length: batchSize }, () => ({
        insertOne: { document: buildDoc(scenarioId, uuidv4(), 'bulk') },
      }));
      await collection.bulkWrite(ops, writeConcernOpts);
      const latencyMs = Date.now() - start;
      metricsTracker.recordOp('write', latencyMs, true);
      emit({
        type: 'bulk',
        status: 'success',
        message: `BULK_WRITE batch=${batchSize} docs acknowledged`,
        latencyMs,
        region: config.APP_REGION,
      });
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      metricsTracker.recordOp('write', latencyMs, false);
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', status: 'failure', message: `BULK_WRITE failed: ${msg}`, latencyMs, region: config.APP_REGION });
    }
    emitMetrics();
    await sleep(interval, signal);
  }
}

export function getWorkloadStatus() {
  return {
    status: abortController ? ('running' as const) : ('idle' as const),
    type: currentWorkloadType,
    scenarioId: currentScenarioId,
  };
}

export async function startWorkload(type: WorkloadType, cfg: WorkloadConfig): Promise<string> {
  if (abortController) {
    throw new Error('A workload is already running. Stop it first.');
  }

  abortController = new AbortController();
  const scenarioId = cfg.scenarioId ?? uuidv4();
  currentScenarioId = scenarioId;
  currentWorkloadType = type;

  metricsTracker.setWorkloadStatus('running', type, scenarioId);

  emit({
    type: 'system',
    status: 'info',
    message: `▶ Starting ${type} workload | scenarioId=${scenarioId} | concurrency=${cfg.concurrency ?? config.DEFAULT_WORKLOAD_CONCURRENCY}`,
    region: config.APP_REGION,
  });

  eventBus.broadcast({
    type: 'workload_status',
    payload: getWorkloadStatus(),
    timestamp: new Date().toISOString(),
  });

  const { signal } = abortController;
  const concurrency = cfg.concurrency ?? config.DEFAULT_WORKLOAD_CONCURRENCY;

  const runners: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    let runner: Promise<void>;
    switch (type) {
      case 'write':
        runner = runWriteLoop(scenarioId, cfg, signal);
        break;
      case 'read':
        runner = runReadLoop(scenarioId, cfg, signal);
        break;
      case 'update':
        runner = runUpdateLoop(scenarioId, cfg, signal);
        break;
      case 'mixed':
        runner = runMixedLoop(scenarioId, cfg, signal);
        break;
      case 'bulk':
        runner = runBulkLoop(scenarioId, cfg, signal);
        break;
      default:
        runner = Promise.resolve();
    }
    runners.push(runner);
  }

  Promise.all(runners)
    .then(() => {
      abortController = null;
      currentWorkloadType = null;
      currentScenarioId = null;
      metricsTracker.setWorkloadStatus('idle');
      emit({
        type: 'system',
        status: 'info',
        message: `■ ${type} workload stopped | scenarioId=${scenarioId}`,
        region: config.APP_REGION,
      });
      eventBus.broadcast({
        type: 'workload_status',
        payload: getWorkloadStatus(),
        timestamp: new Date().toISOString(),
      });
    })
    .catch((err: unknown) => {
      abortController = null;
      currentWorkloadType = null;
      currentScenarioId = null;
      metricsTracker.setWorkloadStatus('error');
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', status: 'failure', message: `Workload runner error: ${msg}`, region: config.APP_REGION });
    });

  return scenarioId;
}

export function stopWorkload(): { stopped: boolean } {
  if (!abortController) {
    throw new Error('No workload is currently running.');
  }
  metricsTracker.setWorkloadStatus('stopping');
  abortController.abort();
  abortController = null;
  return { stopped: true };
}
