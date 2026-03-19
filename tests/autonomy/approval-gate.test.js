import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  config: {
    autonomyApprovalTimeoutMs: 500, // short timeout for tests
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/events/event-bus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), clear: vi.fn() },
}));

vi.mock('../../src/autonomy/approval-channels.js', () => ({
  approvalChannels: {
    notifyChannels: vi.fn(),
    listenForResponse: vi.fn(),
    registerChannel: vi.fn(),
  },
}));

const { ApprovalGate } = await import('../../src/autonomy/approval-gate.js');
const { approvalChannels } = await import('../../src/autonomy/approval-channels.js');
const { eventBus } = await import('../../src/events/event-bus.js');

// ─── ACCEPTANCE CRITERIA TESTS ───────────────────────────────────────

describe('ApprovalGate — Acceptance Criteria', () => {
  let gate;

  beforeEach(() => {
    vi.clearAllMocks();
    gate = new ApprovalGate();
  });

  it('AC: waitForApproval() resolves with approved=true when channel responds', async () => {
    approvalChannels.listenForResponse.mockResolvedValue({
      approved: true,
      respondedBy: 'dashboard-user',
      timedOut: false,
    });

    const result = await gate.waitForApproval({
      action: 'pre-code',
      context: {},
      reasons: ['Test reason'],
    });

    expect(result.approved).toBe(true);
    expect(result.respondedBy).toBe('dashboard-user');
    expect(result.timedOut).toBe(false);
  });

  it('AC: waitForApproval() resolves with approved=false on timeout', async () => {
    // listenForResponse never resolves, so timeout wins
    approvalChannels.listenForResponse.mockReturnValue(new Promise(() => {}));

    const result = await gate.waitForApproval({
      action: 'pre-merge',
      context: {},
      reasons: ['Needs review'],
    });

    expect(result.approved).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.respondedBy).toBeNull();
  }, 5000);

  it('AC: waitForApproval() notifies channels before waiting', async () => {
    approvalChannels.listenForResponse.mockResolvedValue({
      approved: true,
      respondedBy: 'api',
      timedOut: false,
    });

    await gate.waitForApproval({
      action: 'deploy',
      context: { task: 'test' },
      reasons: ['Manual review'],
    });

    expect(approvalChannels.notifyChannels).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'deploy',
        status: 'pending',
        reasons: ['Manual review'],
      }),
    );
  });

  it('AC: emits autonomy:approval-timeout event on timeout', async () => {
    approvalChannels.listenForResponse.mockReturnValue(new Promise(() => {}));

    await gate.waitForApproval({
      action: 'pre-code',
      context: {},
      reasons: [],
    });

    expect(eventBus.emit).toHaveBeenCalledWith('autonomy:approval-timeout', expect.objectContaining({
      action: 'pre-code',
    }));
  }, 5000);
});

// ─── UNIT TESTS ──────────────────────────────────────────────────────

describe('ApprovalGate — Unit', () => {
  let gate;

  beforeEach(() => {
    vi.clearAllMocks();
    gate = new ApprovalGate();
  });

  it('generates unique requestIds', async () => {
    const ids = [];
    approvalChannels.notifyChannels.mockImplementation((req) => ids.push(req.requestId));
    approvalChannels.listenForResponse.mockResolvedValue({ approved: true, respondedBy: 'api', timedOut: false });

    await gate.waitForApproval({ action: 'a', reasons: [] });
    await gate.waitForApproval({ action: 'b', reasons: [] });

    expect(ids[0]).not.toBe(ids[1]);
  });

  it('returns result with correct shape', async () => {
    approvalChannels.listenForResponse.mockResolvedValue({ approved: false, respondedBy: 'user', timedOut: false });

    const result = await gate.waitForApproval({ action: 'test', reasons: [] });

    expect(result).toHaveProperty('approved');
    expect(result).toHaveProperty('respondedBy');
    expect(result).toHaveProperty('timedOut');
    expect(typeof result.approved).toBe('boolean');
  });
});

// ─── EDGE CASES ──────────────────────────────────────────────────────

describe('ApprovalGate — Edge Cases', () => {
  let gate;

  beforeEach(() => {
    vi.clearAllMocks();
    gate = new ApprovalGate();
  });

  it('handles denial response correctly', async () => {
    approvalChannels.listenForResponse.mockResolvedValue({
      approved: false,
      respondedBy: 'admin',
      timedOut: false,
    });

    const result = await gate.waitForApproval({ action: 'risky', reasons: ['security'] });
    expect(result.approved).toBe(false);
    expect(result.respondedBy).toBe('admin');
  });

  it('handles empty reasons array', async () => {
    approvalChannels.listenForResponse.mockResolvedValue({ approved: true, respondedBy: 'user', timedOut: false });

    const result = await gate.waitForApproval({ action: 'test', context: {}, reasons: [] });
    expect(result.approved).toBe(true);
  });

  it('respondedBy defaults to null when missing from response', async () => {
    approvalChannels.listenForResponse.mockResolvedValue({ approved: true });

    const result = await gate.waitForApproval({ action: 'test', reasons: [] });
    expect(result.respondedBy).toBeNull();
  });
});
