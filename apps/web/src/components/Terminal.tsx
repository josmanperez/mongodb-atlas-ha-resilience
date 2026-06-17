import { useRef, useLayoutEffect, useCallback, useState } from 'react';
import { Terminal as TerminalIcon, Trash2, ArrowDownToLine, GitBranch } from 'lucide-react';
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Hide change-stream events by default — they're verbose and secondary to HA demo
  const [showCS, setShowCS] = useState(false);

  const visibleEvents = showCS ? events : events.filter(e => e.type !== 'change_stream');

  // Separate ref (scroll logic, no re-renders) from state (button visual only).
  const followingRef = useRef(true);
  const [followingUI, setFollowingUI] = useState(true);

  // Track total events received, including those evicted from the 500-event ring buffer.
  // Updated during render (safe for refs) — resets when terminal is cleared.
  const totalRef = useRef(0);
  const prevIdRef = useRef('');
  const lastRawId = events[events.length - 1]?.id ?? '';
  if (events.length === 0) {
    totalRef.current = 0;
    prevIdRef.current = '';
  } else if (lastRawId !== prevIdRef.current) {
    prevIdRef.current = lastRawId;
    totalRef.current += 1;
  }

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // useLayoutEffect (no deps) runs after every DOM commit — before paint.
  // Setting scrollTop here means the user never sees the un-scrolled state,
  // and any resulting scroll event sees atBottom=true, keeping followingRef stable.
  useLayoutEffect(() => {
    if (followingRef.current) scrollToBottom();
  });

  // User-initiated scroll: detect whether we're at the bottom.
  // No ownScrollRef needed — our programmatic scrolls happen in useLayoutEffect
  // (before paint), so by the time any resulting scroll event fires, scrollTop
  // is already at the bottom and atBottom evaluates correctly to true.
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (followingRef.current !== atBottom) {
      followingRef.current = atBottom;
      setFollowingUI(atBottom);
    }
  }, []);

  const toggleFollowing = useCallback(() => {
    const next = !followingRef.current;
    followingRef.current = next;
    setFollowingUI(next);
    if (next) scrollToBottom();
  }, [scrollToBottom]);

  const SPRING = 'transition-all duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]';

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

        <div className="flex items-center gap-2">
          {/* Change stream toggle */}
          <button
            onClick={() => setShowCS(v => !v)}
            title={showCS ? 'Hide change stream events' : 'Show change stream events'}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono active:scale-95 ${SPRING} ${
              showCS
                ? 'bg-cyan-500/[0.12] border-cyan-500/30 text-cyan-400'
                : 'bg-white/[0.04] border-white/[0.08] text-gray-600 hover:text-gray-400 hover:border-white/[0.14]'
            }`}
          >
            <GitBranch className="w-2.5 h-2.5 shrink-0" />
            CS
          </button>

          {/* Follow toggle */}
          <button
            onClick={toggleFollowing}
            title={followingUI ? 'Auto-scroll on — click to pause' : 'Auto-scroll paused — click to jump to bottom'}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono active:scale-95 ${SPRING} ${
              followingUI
                ? 'bg-mdb-green/[0.12] border-mdb-green/30 text-mdb-green'
                : 'bg-white/[0.04] border-white/[0.08] text-gray-500 hover:text-gray-300 hover:border-white/[0.14]'
            }`}
          >
            <ArrowDownToLine className="w-2.5 h-2.5 shrink-0" />
            Follow
          </button>

          <span className="text-xs text-gray-700 font-mono">
            {totalRef.current > visibleEvents.length
              ? `${visibleEvents.length} / ${totalRef.current.toLocaleString()}`
              : visibleEvents.length
            } events
          </span>

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
        {visibleEvents.length === 0 ? (
          <div className="text-gray-700 select-none leading-relaxed">
            <p className="text-gray-500 mb-1">MongoDB Atlas HA Demo — ready</p>
            <p>Waiting for events… Start a workload to begin.</p>
            <span className="text-mdb-green animate-blink">█</span>
          </div>
        ) : (
          visibleEvents.map((event) => (
            <div
              key={event.id}
              className="flex gap-2 hover:bg-gray-900/60 rounded px-1 py-0.5"
            >
              <span className="text-gray-700 shrink-0 tabular-nums">
                {new Date(event.timestamp).toLocaleTimeString('en-US', {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>

              <span
                className={`shrink-0 w-4 text-center ${
                  event.status === 'success' ? 'text-mdb-green'
                  : event.status === 'failure' ? 'text-red-400'
                  : event.status === 'warning' ? 'text-yellow-400'
                  : 'text-gray-600'
                }`}
              >
                {STATUS_PREFIX[event.status] ?? '·'}
              </span>

              <span
                className={`shrink-0 w-16 uppercase tracking-wide ${
                  TYPE_COLORS[event.type] ?? 'text-gray-400'
                }`}
              >
                {event.type.replace('_', ' ').slice(0, 12)}
              </span>

              <span className="text-gray-300 flex-1 min-w-0 truncate">
                {event.message}
              </span>

              {event.latencyMs !== undefined && (
                <span
                  className={`shrink-0 tabular-nums ${
                    event.latencyMs > 200 ? 'text-red-400'
                    : event.latencyMs > 100 ? 'text-orange-400'
                    : event.latencyMs > 50 ? 'text-yellow-400'
                    : 'text-mdb-green'
                  }`}
                >
                  {event.latencyMs}ms
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
