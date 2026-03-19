import { describe, it, expect, vi } from 'vitest';
import { buildIncrementalContext } from '../src/cycle/incremental-review.js';
import { runParallelAgents } from '../src/cycle/pipeline-scheduler.js';

describe('incremental-review', () => {
  it('returns full diff when no lastReviewSHA', () => {
    const result = buildIncrementalContext(null, 'abc123', 'full diff content', '.');
    expect(result.isIncremental).toBe(false);
    expect(result.diff).toBe('full diff content');
  });

  it('falls back to full diff on git error', () => {
    const result = buildIncrementalContext('invalid', 'also-invalid', 'full diff', '.');
    expect(result.isIncremental).toBe(false);
    expect(result.diff).toBe('full diff');
  });
});

describe('pipeline-scheduler', () => {
  it('runs parallel agents concurrently', async () => {
    const order = [];
    const agents = [
      {
        name: 'A',
        parallel: true,
        execute: async () => {
          await new Promise(r => setTimeout(r, 50));
          order.push('A');
          return { success: true };
        },
      },
      {
        name: 'B',
        parallel: true,
        execute: async () => {
          await new Promise(r => setTimeout(r, 50));
          order.push('B');
          return { success: true };
        },
      },
    ];

    const results = await runParallelAgents(agents);
    expect(results.A.success).toBe(true);
    expect(results.B.success).toBe(true);
    // Both should finish close together (parallel, not sequential)
    expect(order.length).toBe(2);
  });

  it('runs sequential agents in order', async () => {
    const order = [];
    const agents = [
      {
        name: 'FIRST',
        parallel: false,
        execute: async () => { order.push('FIRST'); return { success: true }; },
      },
      {
        name: 'SECOND',
        parallel: false,
        execute: async () => { order.push('SECOND'); return { success: true }; },
      },
    ];

    const results = await runParallelAgents(agents);
    expect(order).toEqual(['FIRST', 'SECOND']);
    expect(results.FIRST.success).toBe(true);
    expect(results.SECOND.success).toBe(true);
  });

  it('handles agent errors gracefully', async () => {
    const agents = [
      {
        name: 'GOOD',
        parallel: true,
        execute: async () => ({ success: true }),
      },
      {
        name: 'BAD',
        parallel: true,
        execute: async () => { throw new Error('boom'); },
      },
    ];

    const results = await runParallelAgents(agents);
    expect(results.GOOD.success).toBe(true);
    expect(results.BAD.success).toBe(false);
    expect(results.BAD.error).toBe('boom');
  });

  it('mixes parallel and sequential', async () => {
    const order = [];
    const agents = [
      { name: 'P1', parallel: true, execute: async () => { order.push('P1'); return { ok: true }; } },
      { name: 'P2', parallel: true, execute: async () => { order.push('P2'); return { ok: true }; } },
      { name: 'S1', parallel: false, execute: async () => { order.push('S1'); return { ok: true }; } },
    ];

    const results = await runParallelAgents(agents);
    // P1 and P2 run first (parallel), then S1
    expect(order.indexOf('S1')).toBe(2);
    expect(Object.keys(results).length).toBe(3);
  });
});
