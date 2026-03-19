import { describe, it, expect } from 'vitest';
import { parseResult, parseResultAsJson } from '../src/parse-result.js';

// Respuesta real de claude (capturada del test manual anterior)
const CLAUDE_RESPONSE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 5994,
  num_turns: 1,
  result: '{"status":"ok"}',
  total_cost_usd: 0.07,
  modelUsage: { 'claude-opus-4-6[1m]': { inputTokens: 3, outputTokens: 8 } },
});

const ERROR_RESPONSE = JSON.stringify({
  type: 'result',
  subtype: 'error',
  is_error: true,
  duration_ms: 100,
  num_turns: 0,
  result: 'Something went wrong',
  total_cost_usd: 0.01,
  modelUsage: {},
});

describe('parseResult', () => {
  it('parses successful claude response', () => {
    const r = parseResult(CLAUDE_RESPONSE);
    expect(r.success).toBe(true);
    expect(r.result).toBe('{"status":"ok"}');
    expect(r.cost).toBe(0.07);
    expect(r.turns).toBe(1);
    expect(r.duration).toBe(5994);
    expect(r.model).toBe('claude-opus-4-6[1m]');
  });

  it('parses error response', () => {
    const r = parseResult(ERROR_RESPONSE);
    expect(r.success).toBe(false);
    expect(r.result).toBe('Something went wrong');
  });

  it('handles multiline output (JSON lines)', () => {
    const output = '{"type":"progress","data":"working..."}\n' + CLAUDE_RESPONSE;
    const r = parseResult(output);
    expect(r.success).toBe(true);
    expect(r.result).toBe('{"status":"ok"}');
  });

  it('fails on empty input', () => {
    expect(parseResult('')).toMatchObject({ success: false });
    expect(parseResult(null)).toMatchObject({ success: false });
  });

  it('fails on garbage input', () => {
    expect(parseResult('not json at all')).toMatchObject({ success: false });
  });
});

describe('parseResultAsJson', () => {
  it('parses result field as JSON when possible', () => {
    const r = parseResultAsJson(CLAUDE_RESPONSE);
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ status: 'ok' });
  });

  it('returns data=null when result is plain text', () => {
    const textResponse = JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'This is plain text, not JSON',
      total_cost_usd: 0.01,
      num_turns: 1,
      duration_ms: 500,
      modelUsage: {},
    });
    const r = parseResultAsJson(textResponse);
    expect(r.success).toBe(true);
    expect(r.data).toBeNull();
    expect(r.result).toBe('This is plain text, not JSON');
  });

  it('extracts JSON from markdown code blocks', () => {
    const codeBlockResponse = JSON.stringify({
      type: 'result',
      is_error: false,
      result: '```json\n{"taskId": "T1", "title": "Fix bug", "reason": "Highest priority"}\n```',
      total_cost_usd: 0.05,
      num_turns: 1,
      duration_ms: 3000,
      modelUsage: {},
    });
    const r = parseResultAsJson(codeBlockResponse);
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ taskId: 'T1', title: 'Fix bug', reason: 'Highest priority' });
  });
});
