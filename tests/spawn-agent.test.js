import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnAgent } from '../src/spawn-agent.js';
import { eventBus } from '../src/events/event-bus.js';
import { fallbackManager } from '../src/agents/fallback-manager.js';

describe('spawnAgent', () => {
  beforeEach(() => {
    fallbackManager.clear();
    eventBus.clear();
  });

  it('spawns process, sends stdin, captures stdout', async () => {
    const result = await spawnAgent(
      'node',
      'hello from stdin',
      {
        args: ['-e', 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(d))'],
        timeout: 5000,
        agentName: 'TEST',
      }
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('hello from stdin');
    expect(result.rateLimited).toBe(false);
    expect(result.earlyTerminated).toBe(false);
  }, 10000);

  it('rejects on timeout', async () => {
    await expect(
      spawnAgent('node', '', {
        args: ['-e', 'setTimeout(()=>{},60000)'],
        timeout: 500,
        agentName: 'TEST',
      })
    ).rejects.toThrow('Timeout');
  }, 5000);

  it('detects rate limit in stderr and sets rateLimited flag', async () => {
    const fn = vi.fn();
    eventBus.on('rate-limit:detected', fn);

    const result = await spawnAgent(
      'node',
      '',
      {
        args: ['-e', 'process.stderr.write("Error: rate limit exceeded");process.exit(0)'],
        timeout: 5000,
        agentName: 'TEST',
      }
    );

    expect(result.rateLimited).toBe(true);
    expect(fn).toHaveBeenCalled();
  }, 10000);

  it('does NOT false-positive on stdout content mentioning rate limit', async () => {
    // Agent talking about rate limits in its response should NOT trigger detection
    const result = await spawnAgent(
      'node',
      '',
      {
        args: ['-e', 'console.log("the code handles quota exceeded correctly")'],
        timeout: 5000,
        agentName: 'TEST',
      }
    );

    expect(result.rateLimited).toBe(false);
  }, 10000);

  it('watchdog kills long-running process on no-access', async () => {
    // Proceso que escribe "cannot access" y luego se queda vivo esperando
    const result = await spawnAgent(
      'node',
      '',
      {
        args: ['-e', 'process.stdout.write("I cannot access the files");setTimeout(()=>process.exit(0),30000)'],
        timeout: 10000,
        agentName: 'CODER',
        watchdog: true,
      }
    );

    expect(result.earlyTerminated).toBe(true);
    expect(result.terminationReason).toBe('NO_ACCESS');
  }, 15000);

  it('returns isFallback=false and correct effectiveCli', async () => {
    const result = await spawnAgent(
      'node',
      '',
      {
        args: ['-e', 'console.log("ok")'],
        timeout: 5000,
        agentName: 'TEST',
      }
    );
    expect(result.isFallback).toBe(false);
    expect(result.effectiveCli).toBe('node');
  }, 10000);
});
