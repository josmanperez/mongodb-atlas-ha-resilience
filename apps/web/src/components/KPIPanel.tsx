import { useEffect, useState } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import type { MetricsSnapshot } from '@atlas-demo/shared';

interface Props {
  metrics: MetricsSnapshot | null;
}

interface DataPoint {
  v: number;
}

function KPITile({
  label,
  value,
  unit = '',
  valueColor = 'text-white',
  history,
  chartColor,
  sub,
}: {
  label: string;
  value: string | number;
  unit?: string;
  valueColor?: string;
  history?: DataPoint[];
  chartColor?: string;
  sub?: string;
}) {
  return (
    // Double-bezel outer shell
    <div className="p-px rounded-lg bg-gradient-to-b from-white/[0.07] to-transparent ring-1 ring-white/[0.05]">
      {/* Inner core */}
      <div className="relative bg-[#0c0c10] rounded-[calc(0.5rem-1px)] px-3 py-2.5 min-w-0 overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        {/* Sparkline backdrop */}
        {history && history.length > 2 && (
          <div className="absolute inset-0 opacity-[0.12] pointer-events-none">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={chartColor ?? '#00ED64'}
                  fill={chartColor ?? '#00ED64'}
                  dot={false}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="relative z-10">
          <p className="text-[9px] font-display uppercase tracking-[0.12em] text-gray-300 leading-tight mb-1 whitespace-nowrap">
            {label}
          </p>
          <p className={`text-lg font-bold font-display leading-none tabular-nums ${valueColor}`}>
            {value}
            {unit && (
              <span className="text-[10px] font-normal text-gray-600 ml-0.5">{unit}</span>
            )}
          </p>
          {sub && (
            <p className="text-[9px] text-gray-700 mt-0.5 font-mono truncate">{sub}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function KPIPanel({ metrics }: Props) {
  const [histW, setHistW] = useState<DataPoint[]>([]);
  const [histR, setHistR] = useState<DataPoint[]>([]);
  const [histL, setHistL] = useState<DataPoint[]>([]);
  const [histE, setHistE] = useState<DataPoint[]>([]);

  useEffect(() => {
    if (!metrics) return;
    setHistW((h) => [...h, { v: metrics.writesPerSec }].slice(-40));
    setHistR((h) => [...h, { v: metrics.readsPerSec }].slice(-40));
    setHistL((h) => [...h, { v: metrics.avgAckLatencyMs }].slice(-40));
    setHistE((h) => [...h, { v: metrics.errorRate * 100 }].slice(-40));
  }, [metrics]);

  const fmt = (n: number, d = 1) => n.toFixed(d);
  const fmtMs = (n: number) => (n < 1 ? '<1' : Math.round(n).toString());

  const fmtRelative = (iso: string) => {
    const diffS = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diffS < 60) return `${diffS}s ago`;
    if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
    return `${Math.floor(diffS / 3600)}h ago`;
  };

  const errorPct = (metrics?.errorRate ?? 0) * 100;
  const failedOps = metrics?.failedOps ?? 0;
  const avgLatency = metrics?.avgAckLatencyMs ?? 0;
  const p95 = metrics?.p95LatencyMs ?? 0;

  return (
    <div className="px-3 py-2.5 bg-[#080809] border-t border-white/[0.05]">
      <div className="grid grid-cols-6 xl:grid-cols-12 gap-1.5">
        <KPITile
          label="Writes/s"
          value={fmt(metrics?.writesPerSec ?? 0)}
          valueColor="text-mdb-green"
          history={histW}
          chartColor="#00ED64"
        />
        <KPITile
          label="Reads/s"
          value={fmt(metrics?.readsPerSec ?? 0)}
          valueColor="text-blue-400"
          history={histR}
          chartColor="#60a5fa"
        />
        <KPITile
          label="Updates/s"
          value={fmt(metrics?.updatesPerSec ?? 0)}
          valueColor="text-yellow-400"
        />
        <KPITile
          label="ACK Lat"
          value={fmtMs(avgLatency)}
          unit="ms"
          valueColor={avgLatency > 200 ? 'text-red-400' : avgLatency > 100 ? 'text-orange-400' : 'text-mdb-green'}
          history={histL}
          chartColor="#f97316"
        />
        <KPITile
          label="P50"
          value={fmtMs(metrics?.p50LatencyMs ?? 0)}
          unit="ms"
          valueColor="text-gray-200"
        />
        <KPITile
          label="P95"
          value={fmtMs(p95)}
          unit="ms"
          valueColor={p95 > 500 ? 'text-red-400' : p95 > 200 ? 'text-orange-400' : 'text-gray-200'}
        />
        <KPITile
          label="P99"
          value={fmtMs(metrics?.p99LatencyMs ?? 0)}
          unit="ms"
          valueColor={(metrics?.p99LatencyMs ?? 0) > 1000 ? 'text-red-400' : 'text-gray-200'}
        />
        <KPITile
          label="Error %"
          value={fmt(errorPct, 1)}
          unit="%"
          valueColor={errorPct > 10 ? 'text-red-400' : errorPct > 2 ? 'text-orange-400' : 'text-gray-400'}
          history={histE}
          chartColor="#ef4444"
        />
        <KPITile
          label="Retries"
          value={metrics?.retryCount ?? 0}
          valueColor="text-yellow-400"
        />
        <KPITile
          label="Success"
          value={(metrics?.successfulOps ?? 0).toLocaleString()}
          valueColor="text-mdb-green"
        />
        <KPITile
          label="Failed"
          value={failedOps.toLocaleString()}
          valueColor={failedOps > 0 ? 'text-red-400' : 'text-gray-600'}
        />
        <KPITile
          label="Failover"
          value={metrics?.lastFailoverTime ? fmtRelative(metrics.lastFailoverTime) : '—'}
          valueColor="text-orange-400"
          sub={`uptime ${metrics?.uptime ?? 0}s`}
        />
      </div>
    </div>
  );
}
