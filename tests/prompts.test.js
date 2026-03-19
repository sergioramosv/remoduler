import { describe, it, expect } from 'vitest';
import { getPlannerPrompt } from '../src/prompts/planner.js';
import { getArchitectPrompt } from '../src/prompts/architect.js';
import { getCoderPrompt, getCoderFixPrompt } from '../src/prompts/coder.js';
import { getReviewerPrompt } from '../src/prompts/reviewer.js';
import { getQAPrompt } from '../src/prompts/qa.js';
import { getSecurityPrompt } from '../src/prompts/security.js';
import { getTesterPrompt } from '../src/prompts/tester.js';

const TASK = {
  taskId: 'T123',
  title: 'Fix auth module',
  description: 'Fix the login flow',
  userStory: { who: 'usuario', what: 'hacer login', why: 'acceder a la app' },
  acceptanceCriteria: ['Login funciona', 'Error message en fallo'],
  devPoints: 3,
};

describe('prompts', () => {
  it('planner includes projectId and userId', () => {
    const p = getPlannerPrompt({ projectId: 'P1', userId: 'U1', userName: 'Test' });
    expect(p).toContain('P1');
    expect(p).toContain('U1');
    expect(p).toContain('Test');
    expect(p).toContain('PLANNER');
    expect(p).toContain('change_task_status');
  });

  it('architect includes task details and returns read-only instructions', () => {
    const p = getArchitectPrompt({ task: TASK, repoUrl: 'https://github.com/test' });
    expect(p).toContain('T123');
    expect(p).toContain('Fix auth module');
    expect(p).toContain('filesToCreate');
    expect(p).toContain('Solo leer, nunca escribir');
  });

  it('coder includes task, plan and branch', () => {
    const plan = { filesToCreate: ['src/auth.js'], implementationOrder: ['1. Create auth'] };
    const p = getCoderPrompt({ task: TASK, plan, branchName: 'feature/test', repoUrl: 'https://github.com/test' });
    expect(p).toContain('feature/test');
    expect(p).toContain('T123');
    expect(p).toContain('filesToCreate');
    expect(p).toContain('create_branch');
    expect(p).toContain('create_pr');
  });

  it('coder fix includes review issues', () => {
    const issues = [{ severity: 'major', description: 'Missing try/catch' }];
    const p = getCoderFixPrompt({ task: TASK, branchName: 'feature/test', reviewIssues: issues });
    expect(p).toContain('Missing try/catch');
    expect(p).toContain('major');
  });

  it('reviewer supports depth levels', () => {
    const base = { task: TASK, prUrl: 'https://pr/1', branchName: 'feature/test' };

    const quick = getReviewerPrompt({ ...base, depth: 'quick' });
    expect(quick).toContain('quick');
    expect(quick).not.toContain('Edge cases');

    const standard = getReviewerPrompt({ ...base, depth: 'standard' });
    expect(standard).toContain('Naming');
    expect(standard).not.toContain('Patrones');

    const deep = getReviewerPrompt({ ...base, depth: 'deep' });
    expect(deep).toContain('Patrones');

    const forensic = getReviewerPrompt({ ...base, depth: 'forensic' });
    expect(forensic).toContain('forense');
    expect(forensic).toContain('race conditions');
  });

  it('qa includes files changed and acceptance criteria', () => {
    const p = getQAPrompt({ task: TASK, branchName: 'feature/test', filesChanged: ['src/auth.js'] });
    expect(p).toContain('src/auth.js');
    expect(p).toContain('Login funciona');
    expect(p).toContain('failsCoderCode');
  });

  it('security covers OWASP categories', () => {
    const p = getSecurityPrompt({ task: TASK, branchName: 'feature/test', filesChanged: ['src/auth.js'] });
    expect(p).toContain('A01');
    expect(p).toContain('A03 Injection');
    expect(p).toContain('BLOCK');
    expect(p).toContain('CRITICAL');
  });

  it('tester includes architect plan and risks', () => {
    const plan = { risks: ['null pointer'] };
    const p = getTesterPrompt({
      task: TASK, branchName: 'feature/test',
      plan, coderSummary: 'Implemented auth', risks: ['null pointer'],
    });
    expect(p).toContain('null pointer');
    expect(p).toContain('Implemented auth');
    expect(p).toContain('quirúrgicos');
  });
});
