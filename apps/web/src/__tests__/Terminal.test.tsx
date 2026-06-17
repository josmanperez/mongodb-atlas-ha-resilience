import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Terminal from '../components/Terminal';
import type { TerminalEvent } from '@atlas-demo/shared';

function makeEvent(overrides: Partial<TerminalEvent> = {}): TerminalEvent {
  return {
    id: Math.random().toString(36),
    timestamp: new Date().toISOString(),
    type: 'write',
    status: 'success',
    message: 'INSERT acknowledged seq=1',
    region: 'us-east-1',
    ...overrides,
  };
}

describe('Terminal', () => {
  const onClear = vi.fn();

  beforeEach(() => { vi.clearAllMocks(); });

  it('renders without crashing when events is empty', () => {
    render(<Terminal events={[]} onClear={onClear} />);
    expect(screen.getByTitle('Clear terminal')).toBeInTheDocument();
  });

  it('renders all event messages', () => {
    const events = [
      makeEvent({ message: 'INSERT acknowledged seq=1' }),
      makeEvent({ message: 'FIND 10 docs id=shard-00-01[P]', type: 'read' }),
      makeEvent({ message: 'UPDATE pending→active matched=20', type: 'update' }),
    ];
    render(<Terminal events={events} onClear={onClear} />);
    expect(screen.getByText(/INSERT acknowledged seq=1/)).toBeInTheDocument();
    expect(screen.getByText(/FIND 10 docs id=shard-00-01\[P\]/)).toBeInTheDocument();
    expect(screen.getByText(/UPDATE pending→active matched=20/)).toBeInTheDocument();
  });

  it('renders event type badges — CSS uppercase does not change DOM text so we match lowercase', () => {
    const events = [
      makeEvent({ type: 'read',   status: 'success',  message: 'find-msg' }),
      makeEvent({ type: 'write',  status: 'success',  message: 'write-msg' }),
      makeEvent({ type: 'update', status: 'success',  message: 'update-msg' }),
      makeEvent({ type: 'error',  status: 'failure',  message: 'op failed' }),
      makeEvent({ type: 'system', status: 'info',     message: 'sys-msg' }),
    ];
    render(<Terminal events={events} onClear={onClear} />);
    // The span renders {event.type} (lowercase); CSS `uppercase` is visual-only
    expect(screen.getByText('read')).toBeInTheDocument();
    expect(screen.getAllByText('write')[0]).toBeInTheDocument(); // may appear in badge + message
    expect(screen.getByText('update')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('system')).toBeInTheDocument();
  });

  it('calls onClear when the clear button is clicked', () => {
    render(<Terminal events={[makeEvent()]} onClear={onClear} />);
    fireEvent.click(screen.getByTitle('Clear terminal'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('shows visible event count (CS events excluded by default)', () => {
    const events = [
      ...Array.from({ length: 5 }, (_, i) => makeEvent({ message: `op ${i}` })),
      makeEvent({ type: 'change_stream', status: 'info', message: 'CS INSERT id=abc…' }),
      makeEvent({ type: 'change_stream', status: 'info', message: 'CS INSERT id=def…' }),
    ];
    render(<Terminal events={events} onClear={onClear} />);
    // CS events hidden by default → only 5 visible
    expect(screen.getByText('5 events')).toBeInTheDocument();
  });

  it('shows CS events and full count when the CS toggle is enabled', () => {
    const events = [
      makeEvent({ message: 'write op' }),
      makeEvent({ type: 'change_stream', status: 'info', message: 'CS INSERT id=abc…' }),
    ];
    render(<Terminal events={events} onClear={onClear} />);
    // Default: 1 visible
    expect(screen.getByText('1 events')).toBeInTheDocument();
    // Enable CS
    fireEvent.click(screen.getByTitle('Show change stream events'));
    expect(screen.getByText('2 events')).toBeInTheDocument();
    expect(screen.getByText(/CS INSERT id=abc/)).toBeInTheDocument();
  });

  it('renders the Follow button by its visible label text', () => {
    render(<Terminal events={[makeEvent()]} onClear={onClear} />);
    // Button text is "Follow"; its title changes based on state but the label is stable
    expect(screen.getByText('Follow')).toBeInTheDocument();
  });

  it('renders latency value when present', () => {
    render(<Terminal events={[makeEvent({ latencyMs: 57 })]} onClear={onClear} />);
    expect(screen.getByText('57ms')).toBeInTheDocument();
  });

  it('renders the server routing tag embedded in the message', () => {
    render(
      <Terminal
        events={[makeEvent({ type: 'read', message: 'FIND 10 docs id=shard-00-01[P]' })]}
        onClear={onClear}
      />
    );
    // The full message is rendered in a single <span> — query the containing text
    expect(screen.getByText(/id=shard-00-01\[P\]/)).toBeInTheDocument();
  });
});
