import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/events/event-bus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), clear: vi.fn() },
}));

const { ApprovalChannels } = await import('../../src/autonomy/approval-channels.js');
const { eventBus } = await import('../../src/events/event-bus.js');

// ─── ACCEPTANCE CRITERIA TESTS ───────────────────────────────────────

describe('ApprovalChannels — Acceptance Criteria', () => {
  let channels;

  beforeEach(() => {
    vi.clearAllMocks();
    channels = new ApprovalChannels();
  });

  it('AC: supports dashboard channel by default', () => {
    const list = channels.getChannels();
    const dashboardChannel = list.find(c => c.name === 'dashboard');
    expect(dashboardChannel).toBeDefined();
    expect(dashboardChannel.active).toBe(true);
  });

  it('AC: supports api channel by default', () => {
    const list = channels.getChannels();
    const apiChannel = list.find(c => c.name === 'api');
    expect(apiChannel).toBeDefined();
    expect(apiChannel.active).toBe(true);
  });

  it('AC: has exactly dashboard + api channels by default', () => {
    const list = channels.getChannels();
    expect(list).toHaveLength(2);
    const names = list.map(c => c.name).sort();
    expect(names).toEqual(['api', 'dashboard']);
  });

  it('AC: notifyChannels emits autonomy:approval-request event', () => {
    const request = { requestId: 'test-1', action: 'pre-code', reasons: ['test'] };
    channels.notifyChannels(request);

    expect(eventBus.emit).toHaveBeenCalledWith('autonomy:approval-request', expect.objectContaining({
      requestId: 'test-1',
      action: 'pre-code',
      channels: ['dashboard', 'api'],
    }));
  });

  it('AC: notifyChannels includes requestedAt timestamp', () => {
    const before = Date.now();
    channels.notifyChannels({ requestId: 'ts-test', action: 'test' });

    const emitCall = eventBus.emit.mock.calls.find(c => c[0] === 'autonomy:approval-request');
    expect(emitCall[1].requestedAt).toBeGreaterThanOrEqual(before);
    expect(emitCall[1].requestedAt).toBeLessThanOrEqual(Date.now());
  });
});

// ─── UNIT TESTS ──────────────────────────────────────────────────────

describe('ApprovalChannels — Unit', () => {
  let channels;

  beforeEach(() => {
    vi.clearAllMocks();
    channels = new ApprovalChannels();
  });

  it('registerChannel adds a new channel', () => {
    channels.registerChannel('slack');
    const list = channels.getChannels();
    expect(list.find(c => c.name === 'slack')).toBeDefined();
  });

  it('listenForResponse resolves when matching response arrives', async () => {
    // Set up the eventBus.on mock to capture the handler
    let capturedHandler;
    eventBus.on.mockImplementation((event, handler) => {
      if (event === 'autonomy:approval-response') {
        capturedHandler = handler;
      }
    });

    const promise = channels.listenForResponse('req-123');

    // Simulate response
    capturedHandler({ requestId: 'req-123', approved: true, respondedBy: 'admin' });

    const result = await promise;
    expect(result.approved).toBe(true);
    expect(result.respondedBy).toBe('admin');
    expect(eventBus.off).toHaveBeenCalledWith('autonomy:approval-response', capturedHandler);
  });

  it('listenForResponse ignores responses for other requestIds', async () => {
    let capturedHandler;
    eventBus.on.mockImplementation((event, handler) => {
      if (event === 'autonomy:approval-response') {
        capturedHandler = handler;
      }
    });

    const promise = channels.listenForResponse('req-456');

    // Wrong requestId — should not resolve
    capturedHandler({ requestId: 'req-789', approved: true, respondedBy: 'user' });

    // Correct requestId — should resolve
    capturedHandler({ requestId: 'req-456', approved: false, respondedBy: 'admin' });

    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.requestId).toBe('req-456');
  });
});

// ─── EDGE CASES ──────────────────────────────────────────────────────

describe('ApprovalChannels — Edge Cases', () => {
  let channels;

  beforeEach(() => {
    vi.clearAllMocks();
    channels = new ApprovalChannels();
  });

  it('registering same channel name overwrites previous', () => {
    channels.registerChannel('dashboard');
    const list = channels.getChannels();
    const dashboardEntries = list.filter(c => c.name === 'dashboard');
    expect(dashboardEntries).toHaveLength(1);
  });

  it('getChannels returns array (not Map)', () => {
    const list = channels.getChannels();
    expect(Array.isArray(list)).toBe(true);
  });

  it('each channel has name and active properties', () => {
    const list = channels.getChannels();
    for (const ch of list) {
      expect(ch).toHaveProperty('name');
      expect(ch).toHaveProperty('active');
      expect(typeof ch.name).toBe('string');
      expect(typeof ch.active).toBe('boolean');
    }
  });
});
