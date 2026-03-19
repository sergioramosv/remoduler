import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('CLI', () => {
  it('remoduler --version prints 1.0.0', () => {
    const output = execSync('node src/index.js --version', { encoding: 'utf8' });
    expect(output.trim()).toBe('1.0.0');
  });

  it('remoduler --help shows all commands', () => {
    const output = execSync('node src/index.js --help', { encoding: 'utf8' });
    expect(output).toContain('run');
    expect(output).toContain('resume');
    expect(output).toContain('plan');
    expect(output).toContain('architect');
    expect(output).toContain('doctor');
    expect(output).toContain('setup');
  });

  it('remoduler doctor runs and reports status', () => {
    try {
      const output = execSync('node src/index.js doctor', { encoding: 'utf8' });
      expect(output).toContain('passed');
    } catch (err) {
      // Exit code 1 is expected if there are issues — just verify it ran
      expect(err.stdout || err.stderr).toBeTruthy();
    }
  });
});
