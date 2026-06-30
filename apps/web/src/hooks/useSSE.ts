import { useEffect, useRef, useState, useCallback } from 'react';
import type { SSEEvent, TerminalEvent, MetricsSnapshot } from '@atlas-demo/shared';

interface SSEState {
  connected: boolean;
  terminalEvents: TerminalEvent[];
  csEvents: TerminalEvent[];
  metrics: MetricsSnapshot | null;
}

const MAX_TERMINAL_EVENTS = 500;
// change_stream events get a separate, smaller ring buffer so high-throughput
// workloads (bulk/update with many docs per op) don't evict op-events from
// the main buffer. Each updateMany(234 docs) fires 234 change_stream events
// but only 1 terminal event — the shared buffer was filling ~99% with cs noise.
const MAX_CS_EVENTS = 200;

export function useSSE() {
  const [state, setState] = useState<SSEState>({
    connected: false,
    terminalEvents: [],
    csEvents: [],
    metrics: null,
  });

  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) return;

    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const sseUrl = isLocal ? 'http://localhost:8081/api/events/stream' : '/api/events/stream';
    const es = new EventSource(sseUrl);
    esRef.current = es;

    es.onopen = () => setState((s) => ({ ...s, connected: true }));

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent;

        setState((s) => {
          if (event.type === 'metrics') {
            return { ...s, metrics: event.payload as MetricsSnapshot };
          }
          if (event.type === 'change_stream') {
            const te = event.payload as TerminalEvent;
            return { ...s, csEvents: [...s.csEvents, te].slice(-MAX_CS_EVENTS) };
          }
          if (event.type === 'terminal') {
            const te = event.payload as TerminalEvent;
            return { ...s, terminalEvents: [...s.terminalEvents, te].slice(-MAX_TERMINAL_EVENTS) };
          }
          if (event.type === 'ping') {
            return { ...s, connected: true };
          }
          return s;
        });
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      setState((s) => ({ ...s, connected: false }));
      es.close();
      esRef.current = null;
      reconnectRef.current = setTimeout(connect, 3_000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  const clearTerminal = useCallback(() => {
    setState((s) => ({ ...s, terminalEvents: [], csEvents: [] }));
  }, []);

  return { ...state, clearTerminal };
}
