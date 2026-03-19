import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('CLI', () => {
  it('remoduler --version prints version', () => {
    const output = execSync('node src/index.js --version', { encoding: 'utf8' });
    expect(output.trim()).toBe('0.1.0');
  });

  it('remoduler --help shows commands', () => {
    const output = execSync('node src/index.js --help', { encoding: 'utf8' });
    expect(output).toContain('remoduler');
    expect(output).toContain('run');
  });
});
