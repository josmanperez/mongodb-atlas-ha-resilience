import crypto from 'crypto';
import { config } from '../config';
import { getLiveClusterName } from '../db/liveConfig';

// 2024-08-05 is the minimum version that returns the advanced cluster description
// format, which is required for multi-cloud / multi-region clusters.
const ATLAS_MEDIA_TYPE = 'application/vnd.atlas.2024-08-05+json';

// ── HTTP Digest Authentication ──────────────────────────────────────────────
// Atlas Admin API v2 requires Digest auth, not Basic auth.
// Flow: probe → 401 with WWW-Authenticate: Digest nonce → resend with computed response.

function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex');
}

function parseDigestChallenge(header: string) {
  const get = (key: string) => header.match(new RegExp(`${key}="([^"]+)"`))?.[1] ?? '';
  return {
    realm: get('realm'),
    nonce: get('nonce'),
    qop: header.match(/qop="?([^",\s]+)/)?.[1],
  };
}

function buildDigestHeader(
  method: string,
  uri: string,
  challenge: ReturnType<typeof parseDigestChallenge>
): string {
  const { realm, nonce, qop } = challenge;
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');

  const ha1 = md5(`${config.ATLAS_PUBLIC_KEY}:${realm}:${config.ATLAS_PRIVATE_KEY}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  return [
    `Digest username="${config.ATLAS_PUBLIC_KEY}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    ...(qop ? [`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`] : []),
    `response="${response}"`,
  ].join(', ');
}

// ── Core request ────────────────────────────────────────────────────────────

async function atlasRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!config.ATLAS_PUBLIC_KEY || !config.ATLAS_PRIVATE_KEY) {
    throw new Error('Atlas API credentials (ATLAS_PUBLIC_KEY, ATLAS_PRIVATE_KEY) are not configured.');
  }
  if (!config.ENABLE_ATLAS_CONTROL_PLANE) {
    throw new Error('Atlas control plane is disabled. Set ENABLE_ATLAS_CONTROL_PLANE=true to enable.');
  }

  const url = `${config.ATLAS_API_BASE_URL}${path}`;
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
  // uri for Digest HA2 is path + query, no host
  const uri = new URL(url).pathname + new URL(url).search;

  // Step 1: probe — get the Digest challenge (401 + WWW-Authenticate header)
  const probe = await fetch(url, {
    method,
    headers: { Accept: ATLAS_MEDIA_TYPE },
  });

  const wwwAuth = probe.headers.get('WWW-Authenticate') ?? '';
  if (!wwwAuth.toLowerCase().startsWith('digest')) {
    throw new Error(
      `Atlas did not return a Digest challenge (got: "${wwwAuth || 'none'}").\n` +
      `Verify ATLAS_PUBLIC_KEY and ATLAS_PRIVATE_KEY are correct.`
    );
  }

  // Step 2: authenticated request
  const authHeader = buildDigestHeader(method, uri, parseDigestChallenge(wwwAuth));

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': ATLAS_MEDIA_TYPE,
      Accept: ATLAS_MEDIA_TYPE,
      Authorization: authHeader,
    },
    body: bodyStr,
  });

  if (response.status === 429) {
    throw new Error('Atlas API rate limit exceeded. Please wait before retrying.');
  }

  const text = await response.text();

  if (!response.ok) {
    let errorMessage = `Atlas API error: HTTP ${response.status}`;
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const detail = String(json['detail'] ?? json['message'] ?? '');
      const code = json['errorCode'] ? ` [${json['errorCode']}]` : '';
      errorMessage = detail ? `${detail}${code}` : `HTTP ${response.status}${code}`;
      // Log the full Atlas error body so backend logs show the real cause
      console.error(`[Atlas API] ${method} ${path} → ${response.status}`, json);
    } catch {
      console.error(`[Atlas API] ${method} ${path} → ${response.status} (non-JSON body)`, text);
    }
    throw new Error(errorMessage);
  }

  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

// ── Public API functions ────────────────────────────────────────────────────

export async function getCluster(): Promise<Record<string, unknown>> {
  const projectId = config.ATLAS_PROJECT_ID;
  const clusterName = getLiveClusterName();
  if (!projectId || !clusterName) {
    throw new Error('ATLAS_PROJECT_ID and ATLAS_CLUSTER_NAME must be configured.');
  }
  return atlasRequest<Record<string, unknown>>(
    'GET',
    `/groups/${projectId}/clusters/${clusterName}`
  );
}

export async function triggerFailover(confirmed: boolean): Promise<void> {
  if (!confirmed) throw new Error('Failover requires explicit confirmation (confirmed: true).');
  if (!config.ENABLE_DESTRUCTIVE_ACTIONS) {
    throw new Error('Destructive actions are disabled. Set ENABLE_DESTRUCTIVE_ACTIONS=true to enable failover.');
  }
  const projectId = config.ATLAS_PROJECT_ID;
  const clusterName = getLiveClusterName();
  if (!projectId || !clusterName) {
    throw new Error('ATLAS_PROJECT_ID and ATLAS_CLUSTER_NAME must be configured.');
  }
  await atlasRequest<void>('POST', `/groups/${projectId}/clusters/${clusterName}/restartPrimaries`);
}

export async function startOutage(
  confirmed: boolean,
  providerName: string,
  regionName: string
): Promise<Record<string, unknown>> {
  if (!confirmed) throw new Error('Outage simulation requires explicit confirmation (confirmed: true).');
  if (!config.ENABLE_DESTRUCTIVE_ACTIONS) {
    throw new Error('Destructive actions are disabled. Set ENABLE_DESTRUCTIVE_ACTIONS=true to enable outage simulation.');
  }
  const projectId = config.ATLAS_PROJECT_ID;
  const clusterName = getLiveClusterName();
  if (!projectId || !clusterName) {
    throw new Error('ATLAS_PROJECT_ID and ATLAS_CLUSTER_NAME must be configured.');
  }
  // Atlas requires all three fields: type, cloudProvider, and regionName.
  // Omitting `type` causes UNEXPECTED_ERROR; omitting cloudProvider also fails.
  return atlasRequest<Record<string, unknown>>(
    'POST',
    `/groups/${projectId}/clusters/${clusterName}/outageSimulation`,
    { outageFilters: [{ type: 'REGION', cloudProvider: providerName, regionName }] }
  );
}

export async function endOutage(): Promise<Record<string, unknown>> {
  const projectId = config.ATLAS_PROJECT_ID;
  const clusterName = getLiveClusterName();
  if (!projectId || !clusterName) {
    throw new Error('ATLAS_PROJECT_ID and ATLAS_CLUSTER_NAME must be configured.');
  }
  return atlasRequest<Record<string, unknown>>(
    'DELETE',
    `/groups/${projectId}/clusters/${clusterName}/outageSimulation`
  );
}

export async function getOutageStatus(): Promise<Record<string, unknown>> {
  const projectId = config.ATLAS_PROJECT_ID;
  const clusterName = getLiveClusterName();
  if (!projectId || !clusterName) {
    throw new Error('ATLAS_PROJECT_ID and ATLAS_CLUSTER_NAME must be configured.');
  }
  try {
    return await atlasRequest<Record<string, unknown>>(
      'GET',
      `/groups/${projectId}/clusters/${clusterName}/outageSimulation`
    );
  } catch (err) {
    // Atlas returns 404 when no outage simulation is active — not an error condition
    if (err instanceof Error && err.message === 'HTTP 404') return {};
    throw err;
  }
}

export interface AtlasProcess {
  id: string;
  hostname: string;
  port: number;
  typeName: string;
  version: string;
  replicaSetName?: string;
  userAlias?: string;
}

export async function resumeCluster(): Promise<Record<string, unknown>> {
  const projectId = config.ATLAS_PROJECT_ID;
  const clusterName = getLiveClusterName();
  if (!projectId || !clusterName) {
    throw new Error('ATLAS_PROJECT_ID and ATLAS_CLUSTER_NAME must be configured.');
  }
  return atlasRequest<Record<string, unknown>>(
    'PATCH',
    `/groups/${projectId}/clusters/${clusterName}`,
    { paused: false }
  );
}

// Derives a shard-id → { provider, region } map by combining the ordered process
// list with the replicationSpecs node counts.
//
// Atlas provisions shard numbers sequentially by region in priority order, so:
//   priority-7 region with 3 nodes → shard-00-00, shard-00-01, shard-00-02
//   priority-6 region with 2 nodes → shard-00-03, shard-00-04
//   ...
//
// This is an inference — Atlas has no explicit per-process region field — but
// consistent with how Atlas assigns shard numbers and confirmed by the topology
// UI which shows the same mapping.
export function buildNodeRegionMap(
  processes: AtlasProcess[],
  clusterInfo: Record<string, unknown>
): Map<string, { provider: string; region: string }> {
  const map = new Map<string, { provider: string; region: string }>();

  const specs = clusterInfo['replicationSpecs'] as Array<Record<string, unknown>> | undefined;
  if (!specs) return map;

  // Collect electable regions sorted by priority (highest first, matching Atlas UI)
  const regions: Array<{ provider: string; region: string; priority: number; nodeCount: number }> = [];
  for (const spec of specs) {
    const rcs = spec['regionConfigs'] as Array<Record<string, unknown>> | undefined;
    if (!rcs) continue;
    for (const rc of rcs) {
      const electable = rc['electableSpecs'] as Record<string, unknown> | undefined;
      const nodeCount = (electable?.['nodeCount'] as number) ?? 0;
      if (nodeCount > 0) {
        regions.push({
          provider:  (rc['providerName'] as string) ?? '',
          region:    (rc['regionName']   as string) ?? '',
          priority:  (rc['priority']     as number) ?? 0,
          nodeCount,
        });
      }
    }
  }
  regions.sort((a, b) => b.priority - a.priority);

  // Expand to a slot-per-node list
  const slots: Array<{ provider: string; region: string }> = [];
  for (const r of regions) {
    for (let i = 0; i < r.nodeCount; i++) slots.push({ provider: r.provider, region: r.region });
  }

  // Sort processes by hostname (Atlas returns them alphabetically by shard number)
  const sorted = [...processes].sort((a, b) => a.hostname.localeCompare(b.hostname));
  sorted.forEach((proc, idx) => {
    const shardId = (proc.userAlias ?? proc.hostname).match(/shard-\d{2}-\d{2}/)?.[0];
    if (shardId && slots[idx]) map.set(shardId, slots[idx]);
  });

  return map;
}

export async function getProcesses(): Promise<AtlasProcess[]> {
  const projectId = config.ATLAS_PROJECT_ID;
  const clusterName = getLiveClusterName();
  if (!projectId) throw new Error('ATLAS_PROJECT_ID must be configured.');
  const result = await atlasRequest<{ results: AtlasProcess[] }>(
    'GET',
    `/groups/${projectId}/processes`
  );
  const all = result.results ?? [];
  // A project can contain multiple clusters. Filter to only our cluster using
  // userAlias, which Atlas sets to "<clusterName>-shard-00-XX.<host>".
  // Falls back to all processes if nothing matches (prevents empty topology).
  if (clusterName) {
    const prefix = clusterName.toLowerCase();
    const filtered = all.filter(p =>
      (p.userAlias ?? p.hostname).toLowerCase().startsWith(prefix)
    );
    if (filtered.length > 0) return filtered;
  }
  return all;
}
