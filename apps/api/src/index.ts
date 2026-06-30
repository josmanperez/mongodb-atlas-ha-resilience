import express from 'express';
import cors from 'cors';
import { config } from './config';
import { getClient } from './db/client';
import { startChangeStream, stopChangeStream } from './db/changeStream';
import { errorHandler } from './middleware/errorHandler';
import healthRouter from './routes/health';
import configRouter from './routes/config';
import atlasRouter from './routes/atlas';
import workloadsRouter from './routes/workloads';
import demoRouter from './routes/demo';
import metricsRouter from './routes/metrics';
import eventsRouter from './routes/events';
import settingsRouter from './routes/settings';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/config', configRouter);
app.use('/api/atlas', atlasRouter);
app.use('/api/workloads', workloadsRouter);
app.use('/api/demo', demoRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/settings', settingsRouter);

app.use(errorHandler);

async function start(): Promise<void> {
  const port = Number(config.PORT);
  app.listen(port, () => {
    console.log(`[Atlas HA Demo] API listening on http://localhost:${port}`);
    console.log(`[Atlas HA Demo] Atlas control plane: ${config.ENABLE_ATLAS_CONTROL_PLANE ? 'ENABLED' : 'disabled'}`);
    console.log(`[Atlas HA Demo] Destructive actions: ${config.ENABLE_DESTRUCTIVE_ACTIONS ? 'ENABLED' : 'disabled'}`);
  });

  try {
    await getClient();
    console.log('[Atlas HA Demo] MongoDB connected');
    await startChangeStream();
    console.log('[Atlas HA Demo] Change stream started');
  } catch (err) {
    // Non-fatal: the settings endpoint remains reachable so the user can
    // override the URI via the UI without restarting the server.
    console.warn('[Atlas HA Demo] Initial MongoDB connection failed — use the settings UI to set a working URI.');
    console.warn(err);
  }
}

process.on('SIGTERM', () => {
  console.log('[Atlas HA Demo] SIGTERM received, shutting down');
  stopChangeStream();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Atlas HA Demo] SIGINT received, shutting down');
  stopChangeStream();
  process.exit(0);
});

start();
