import { Router } from 'express';
import { MongoClient } from 'mongodb';
import { z } from 'zod';
import {
  getLiveMongoUri,
  getLiveClusterName,
  isOverrideActive,
  setOverride,
  extractUriHost,
} from '../db/liveConfig';
import { closeClient, getClient } from '../db/client';
import { stopChangeStream, startChangeStream } from '../db/changeStream';
import { stopWorkload } from '../services/workload';

const router = Router();

function sanitize(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/mongodb(\+srv)?:\/\/[^@]+@/gi, 'mongodb$1://***:***@')
    .replace(/password[=:]\S+/gi, 'password=[REDACTED]');
}

// GET /api/settings/connection — current live connection info (no credentials)
router.get('/connection', (_req, res) => {
  res.json({
    success: true,
    data: {
      isOverride: isOverrideActive(),
      clusterName: getLiveClusterName() ?? '',
      uriHost: extractUriHost(getLiveMongoUri()),
    },
  });
});

const testSchema = z.object({ mongoUri: z.string().min(1) });

// POST /api/settings/connection/test — probe a URI without committing
router.post('/connection/test', async (req, res) => {
  const parse = testSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ success: false, error: 'mongoUri (string) is required' });
  }
  const { mongoUri } = parse.data;
  const testClient = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 8_000,
    connectTimeoutMS: 8_000,
  });
  testClient.on('error', () => {});
  try {
    await testClient.connect();
    await testClient.db().command({ ping: 1 });
    res.json({ success: true, data: { uriHost: extractUriHost(mongoUri) } });
  } catch (err) {
    res.status(400).json({ success: false, error: sanitize(err) });
  } finally {
    await testClient.close().catch(() => {});
  }
});

const applySchema = z.object({
  mongoUri:    z.string().min(1),
  clusterName: z.string().optional(),
});

// POST /api/settings/connection — apply override: stops workload, reconnects
router.post('/connection', async (req, res) => {
  const parse = applySchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ success: false, error: 'mongoUri (string) is required' });
  }
  const { mongoUri, clusterName } = parse.data;

  try { stopWorkload(); } catch { /* no workload running */ }
  stopChangeStream();
  await closeClient();

  try {
    setOverride(mongoUri.trim(), clusterName?.trim() || null);
    await getClient();
    await startChangeStream();
    res.json({
      success: true,
      data: { uriHost: extractUriHost(mongoUri), clusterName: getLiveClusterName() ?? '' },
    });
  } catch (err) {
    // Rollback to env values so the API doesn't stay disconnected
    setOverride(null, null);
    await getClient().catch(() => {});
    await startChangeStream().catch(() => {});
    res.status(500).json({ success: false, error: sanitize(err) });
  }
});

// DELETE /api/settings/connection — reset to .env values
router.delete('/connection', async (req, res) => {
  try { stopWorkload(); } catch { /* no workload running */ }
  stopChangeStream();
  await closeClient();

  try {
    setOverride(null, null);
    await getClient();
    await startChangeStream();
    res.json({ success: true, data: null });
  } catch (err) {
    res.status(500).json({ success: false, error: sanitize(err) });
  }
});

export default router;
