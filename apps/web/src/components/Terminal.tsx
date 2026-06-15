import { useRef, useEffect, useCallback } from 'react';
import { Terminal as TerminalIcon, Trash2 } from 'lucide-react';
import type { TerminalEvent, ConnectionStatus } from '@atlas-demo/shared';

interface Props {
  events: TerminalEvent[];
  onClear: () => void;
  connectionStatus?: ConnectionStatus;
}

const TYPE_COLORS: Record<string, string> = {
  write: 'text-mdb-green',
  read: 'text-blue-400',
  update: 'text-yellow-400',
  delete: 'text-red-400',
  bulk: 'text-purple-400',
  change_stream: 'text-cyan-400',
  failover: 'text-orange-400',
  outage_start: 'text-red-500',
  outage_end: 'text-green-500',
  reconnect: 'text-yellow-300',
  error: 'text-red-400',
  retry: 'text-yellow-500',
  system: 'text-gray-400',
};

const STATUS_PREFIX: Record<string, string> = {
  success: '✓',
  failure: '✗',
  info: '·',
  warning: '⚠',
};

export default function Terminal({ events, onClear, connectionStatus }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // true = follow new output; flips to false when user scrolls up intentionally
  const autoScrollRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distFromBottom < 60;
  }, []);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [events.length]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Chrome bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
          </div>
          <TerminalIcon className="w-3 h-3 text-gray-500" />
          <span className="text-xs text-gray-500 font-mono">
            atlas-ha-demo — event stream
            {connectionStatus && connectionStatus !== 'connected' && (
              <span className="text-yellow-500 ml-2">[{connectionStatus}]</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-700 font-mono">{events.length} events</span>
          <button
            onClick={onClear}
            className="text-gray-600 hover:text-gray-300 transition-colors"
            title="Clear terminal"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Log body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-gray-950 font-mono text-xs p-3 space-y-0.5 scrollbar-thin"
      >
        {events.length === 0 ? (
          <div className="text-gray-700 select-none leading-relaxed">
            <p className="text-gray-500 mb-1">MongoDB Atlas HA Demo — ready</p>
            <p>Waiting for events… Start a workload to begin.</p>
            <span className="text-mdb-green animate-blink">█</span>
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="flex gap-2 hover:bg-gray-900/60 rounded px-1 py-0.5"
            >
              {/* Timestamp */}
              <span className="text-gray-700 shrink-0 tabular-nums">
                {new Date(event.timestamp).toLocaleTimeString('en-US', {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>

              {/* Status glyph */}
              <span
                className={`shrink-0 w-4 text-center ${
                  event.status === 'success'
                    ? 'text-mdb-green'
                    : event.status === 'failure'
                    ? 'text-red-400'
                    : event.status === 'warning'
                    ? 'text-yellow-400'
                    : 'text-gray-600'
                }`}
              >
                {STATUS_PREFIX[event.status] ?? '·'}
              </span>

              {/* Type tag */}
              <span
                className={`shrink-0 w-16 uppercase tracking-wide ${
                  TYPE_COLORS[event.type] ?? 'text-gray-400'
                }`}
              >
                {event.type.replace('_', ' ').slice(0, 12)}
              </span>

              {/* Message */}
              <span className="text-gray-300 flex-1 min-w-0 truncate">
                {event.message}
              </span>

              {/* Latency */}
              {event.latencyMs !== undefined && (
                <span
                  className={`shrink-0 tabular-nums ${
                    event.latencyMs > 200
                      ? 'text-red-400'
                      : event.latencyMs > 100
                      ? 'text-orange-400'
                      : event.latencyMs > 50
                      ? 'text-yellow-400'
                      : 'text-mdb-green'
                  }`}
                >
                  {event.latencyMs}ms
                </span>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
