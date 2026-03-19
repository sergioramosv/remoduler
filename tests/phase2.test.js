import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectRateLimit, parseRetryAfter, checkAndEmitRateLimit } from '../src/agents/rate-limit-detector.js';
import { fallbackManager } from '../src/agents/fallback-manager.js';
import { StreamingWatchdog } from '../src/agents/streaming-watchdog.js';
import { getUnresolvedPreviousParts } from '../src/agents/multi-part-filter.js';
import { eventBus } from '../src/events/event-bus.js';

// --- [2.1] Rate Limit Detector ---
describe('rate-limit-detector', () => {
  it('detects claude rate limit patterns', () => {
    expect(detectRateLimit('Error: rate limit exceeded', 'claude').detected).toBe(true);
    expect(detectRateLimit('Too many requests', 'claude').detected).toBe(true);
    expect(detectRateLimit('HTTP 429', 'claude').detected).toBe(true);
    expect(detectRateLimit('quota exceeded', 'claude').detected).toBe(true);
    expect(detectRateLimit('overloaded', 'claude').detected).toBe(true);
  });

  it('detects codex-specific patterns', () => {
    expect(detectRateLimit('rate_limit_exceeded', 'codex').detected).toBe(true);
    expect(detectRateLimit('tokens per min limit', 'codex').detected).toBe(true);
  });

  it('detects gemini-specific patterns', () => {
    expect(detectRateLimit('RESOURCE_EXHAUSTED', 'gemini').detected).toBe(true);
  });

  it('does not false-positive on normal text', () => {
    expect(detectRateLimit('All tests passed', 'claude').detected).toBe(false);
    expect(detectRateLimit('Created file successfully', 'claude').detected).toBe(false);
    expect(detectRateLimit('', 'claude').detected).toBe(false);
    expect(detectRateLimit(null).detected).toBe(false);
  });

  it('parses retry-after durations', () => {
    expect(parseRetryAfter('retry after 2m30s')).toBe(150);
    expect(parseRetryAfter('retry after 22s')).toBe(22);
    expect(parseRetryAfter('Retry-After: 120')).toBe(120);
    expect(parseRetryAfter('retry in 5 minutes')).toBe(300);
    expect(parseRetryAfter('wait 60s before retrying')).toBe(60);
    expect(parseRetryAfter('no retry info here')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('emits event on detection', () => {
    const fn = vi.fn();
    eventBus.on('rate-limit:detected', fn);
    checkAndEmitRateLimit('rate limit exceeded', 'claude', 'PLANNER');
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({
      cli: 'claude', agentName: 'PLANNER',
    }));
    eventBus.clear();
  });
});

// --- [2.2] Fallback Manager ---
describe('fallback-manager', () => {
  beforeEach(() => fallbackManager.clear());

  it('is enabled by default', () => {
    expect(fallbackManager.isEnabled()).toBe(true);
  });

  it('tracks rate-limited CLIs', () => {
    expect(fallbackManager.isRateLimited('claude')).toBe(false);
    fallbackManager.markRateLimited('claude');
    expect(fallbackManager.isRateLimited('claude')).toBe(true);
  });

  it('recovers CLIs', () => {
    fallbackManager.markRateLimited('claude');
    fallbackManager.markRecovered('claude');
    expect(fallbackManager.isRateLimited('claude')).toBe(false);
  });

  it('resolves effective CLI (no rate limit)', () => {
    const result = fallbackManager.resolveEffectiveCli('claude', 'PLANNER');
    expect(result.cli).toBe('claude');
    expect(result.isFallback).toBe(false);
  });

  it('lists rate-limited CLIs', () => {
    fallbackManager.markRateLimited('claude');
    fallbackManager.markRateLimited('codex');
    expect(fallbackManager.getRateLimitedClis()).toContain('claude');
    expect(fallbackManager.getRateLimitedClis()).toContain('codex');
  });
});

// --- [2.3] Streaming Watchdog ---
describe('streaming-watchdog', () => {
  it('starts non-terminated', () => {
    const wd = new StreamingWatchdog('CODER');
    expect(wd.terminated).toBe(false);
    expect(wd.terminationReason).toBeNull();
  });

  it('detects reviewer early approval', () => {
    const wd = new StreamingWatchdog('REVIEWER', { reviewerMode: true });
    const killFn = vi.fn();
    wd.onKill(killFn);
    wd.feed('{"verdict": "APPROVED", "comments": []}');
    expect(wd.terminated).toBe(true);
    expect(wd.terminationReason).toBe('REVIEWER_EARLY_APPROVED');
    expect(killFn).toHaveBeenCalled();
  });

  it('detects tool loop', () => {
    const wd = new StreamingWatchdog('CODER');
    const killFn = vi.fn();
    wd.onKill(killFn);
    for (let i = 0; i < 5; i++) {
      wd.feed('{"tool_name": "Read"}');
    }
    expect(wd.terminated).toBe(true);
    expect(wd.terminationReason).toBe('TOOL_LOOP');
  });

  it('does not trigger tool loop with different tools', () => {
    const wd = new StreamingWatchdog('CODER');
    wd.feed('{"tool_name": "Read"}');
    wd.feed('{"tool_name": "Write"}');
    wd.feed('{"tool_name": "Read"}');
    wd.feed('{"tool_name": "Write"}');
    wd.feed('{"tool_name": "Read"}');
    expect(wd.terminated).toBe(false);
  });

  it('detects no access', () => {
    const wd = new StreamingWatchdog('CODER');
    wd.feed('I cannot access the file system');
    expect(wd.terminated).toBe(true);
    expect(wd.terminationReason).toBe('NO_ACCESS');
  });

  it('detects wandering for CODER', () => {
    const wd = new StreamingWatchdog('CODER');
    // Feed 5K+ chars without code block
    wd.feed('x'.repeat(5001));
    expect(wd.terminated).toBe(true);
    expect(wd.terminationReason).toBe('WANDERING');
  });

  it('does not detect wandering for non-CODER', () => {
    const wd = new StreamingWatchdog('PLANNER');
    wd.feed('x'.repeat(6000));
    expect(wd.terminated).toBe(false);
  });

  it('ignores feed after termination', () => {
    const wd = new StreamingWatchdog('CODER');
    wd.feed('I cannot access anything');
    expect(wd.terminated).toBe(true);
    const reason = wd.terminationReason;
    wd.feed('{"tool_name": "Read"}');
    expect(wd.terminationReason).toBe(reason); // unchanged
  });
});

// --- [2.4] Multi-Part Filter ---
describe('multi-part-filter', () => {
  const tasks = [
    { id: 'T1', title: 'Setup auth (1/3)', status: 'done' },
    { id: 'T2', title: 'Setup auth (2/3)', status: 'to-do' },
    { id: 'T3', title: 'Setup auth (3/3)', status: 'to-do' },
    { id: 'T4', title: 'Fix login bug', status: 'to-do' },
  ];

  it('part 1 is never blocked', () => {
    expect(getUnresolvedPreviousParts(tasks[0], tasks)).toEqual([]);
  });

  it('part 2 is not blocked when part 1 is done', () => {
    expect(getUnresolvedPreviousParts(tasks[1], tasks)).toEqual([]);
  });

  it('part 3 is blocked when part 2 is not done', () => {
    const result = getUnresolvedPreviousParts(tasks[2], tasks);
    expect(result.length).toBe(1);
    expect(result[0]).toBe('T2');
  });

  it('non-multi-part tasks return empty', () => {
    expect(getUnresolvedPreviousParts(tasks[3], tasks)).toEqual([]);
  });

  it('handles [2/4] bracket format', () => {
    const bracketTasks = [
      { id: 'A', title: 'Deploy [1/2]', status: 'to-do' },
      { id: 'B', title: 'Deploy [2/2]', status: 'to-do' },
    ];
    const result = getUnresolvedPreviousParts(bracketTasks[1], bracketTasks);
    expect(result.length).toBe(1);
  });
});
