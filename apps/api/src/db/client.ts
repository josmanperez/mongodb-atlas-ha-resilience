import { MongoClient } from 'mongodb';
import { config } from '../config';
import { getLiveMongoUri } from './liveConfig';
import type { ConnectionStatus } from '@atlas-demo/shared';

let client: MongoClient | null = null;
let connectionStatus: ConnectionStatus = 'disconnected';

export function getConnectionStatus(): ConnectionStatus {
  return connectionStatus;
}

// Returns the hostname:port of the replica set primary as reported by the driver's
// live `hello` command. More reliable than reading internal SDAM topology state:
// the `primary` field in the hello response is exactly what the driver uses for
// write routing, and it updates immediately after an election or failover.
export async function getDriverPrimary(): Promise<string | null> {
  try {
    if (!client) return null;
    const result = await client.db().command({ hello: 1 });
    return (result.primary as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function getClient(): Promise<MongoClient> {
  if (client) return client;

  connectionStatus = 'reconnecting';

  // OLTP long-running server configuration per MongoDB connection best practices:
  // - maxPoolSize 50: sized for demo concurrency (up to 5 workers × 10 headroom)
  // - minPoolSize 10: pre-warmed connections for immediate demo responsiveness
  // - maxIdleTimeMS 300000: 5min keep-alive on a stable server
  // - serverSelectionTimeoutMS 10000: fail fast on topology changes during failover demo
  client = new MongoClient(getLiveMongoUri(), {
    maxPoolSize: 50,
    minPoolSize: 10,
    maxIdleTimeMS: 300_000,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
    retryWrites: true,
    retryReads: true,
  });

  // Attach error handler before connect() so that if connect() rejects and the
  // client is abandoned (client = null), any subsequent async error events from
  // the driver don't become unhandled 'error' events that crash the process.
  client.on('error', () => { connectionStatus = 'error'; });
  client.on('serverOpening', () => { connectionStatus = 'connected'; });
  client.on('serverClosed', () => { connectionStatus = 'reconnecting'; });
  client.on('close', () => { connectionStatus = 'disconnected'; });

  try {
    await client.connect();
    connectionStatus = 'connected';
    console.log('[MongoDB] Client connected');
    return client;
  } catch (err) {
    connectionStatus = 'error';
    const failedClient = client;
    client = null;
    failedClient.close().catch(() => {});
    throw err;
  }
}

export function getDb() {
  if (!client) throw new Error('MongoDB client not initialized. Call getClient() first.');
  return client.db(config.MONGODB_DB_NAME);
}

export function getCollection() {
  return getDb().collection(config.MONGODB_COLLECTION_NAME);
}

export async function closeClient() {
  if (client) {
    await client.close();
    client = null;
    connectionStatus = 'disconnected';
  }
}
