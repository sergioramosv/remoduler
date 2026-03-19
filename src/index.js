#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { Command } from 'commander';
import { spawnAgent } from './spawn-agent.js';
import { parseResultAsJson } from './parse-result.js';
import { runPlanner } from './agents/planner.js';
import { runArchitect } from './agents/architect.js';
import { runTask } from './cycle/task-runner.js';

const program = new Command();

program
  .name('remoduler')
  .description('Orquestador de agentes IA autonomo')
  .version('0.1.0');

program
  .command('run')
  .description('Ejecutar el pipeline completo: Plan → Architect → Code → Test → Review')
  .option('-p, --project <id>', 'Project ID')
  .option('-t, --tasks <n>', 'Número de tareas a ejecutar', '1')
  .option('--cwd <path>', 'Directorio del repo target', process.cwd())
  .action(async (opts) => {
    const projectId = opts.project || process.env.DEFAULT_PROJECT_ID;
    if (!projectId) {
      console.error('No project ID. Set DEFAULT_PROJECT_ID in .env or use -p <id>');
      process.exit(1);
    }

    const numTasks = parseInt(opts.tasks);
    console.log(`Remoduler: running ${numTasks} task(s) for project ${projectId}\n`);

    for (let i = 0; i < numTasks; i++) {
      const result = await runTask(projectId, opts.cwd);
      if (!result) {
        console.log('No more tasks in backlog.');
        break;
      }
      if (result.rateLimited) {
        console.log('Rate limited. Stopping.');
        break;
      }
      console.log(`\nTask ${i + 1} done: ${result.success ? 'SUCCESS' : 'FAILED'} | Cost: $${result.totalCost?.toFixed(4)}\n`);
    }
  });

program
  .command('plan')
  .description('Seleccionar la mejor tarea del backlog')
  .option('-p, --project <id>', 'Project ID')
  .action(async (opts) => {
    const projectId = opts.project || process.env.DEFAULT_PROJECT_ID;
    const userId = process.env.DEFAULT_USER_ID;
    const userName = process.env.DEFAULT_USER_NAME || 'Remoduler';

    if (!projectId) {
      console.error('No project ID. Set DEFAULT_PROJECT_ID in .env or use -p <id>');
      process.exit(1);
    }

    console.log(`Planning for project ${projectId}...`);
    const result = await runPlanner({ projectId, userId, userName });

    if (!result.success) {
      console.error('Planner failed:', result.error);
      if (result.raw) console.error('Raw:', result.raw);
      if (result.stderr) console.error('Stderr:', result.stderr);
      process.exit(1);
    }

    if (result.empty) {
      console.log(result.message);
      return;
    }

    console.log(`\n✓ Selected task:`);
    console.log(`  ID:       ${result.taskId}`);
    console.log(`  Title:    ${result.title}`);
    console.log(`  Branch:   ${result.branchName}`);
    console.log(`  Repo:     ${result.repoUrl}`);
    console.log(`  Points:   ${result.devPoints}`);
    console.log(`  Sprint:   ${result.sprintId || 'none'}`);
    console.log(`  Reason:   ${result.reason}`);
    console.log(`\n  Cost: $${result.cost?.toFixed(4)} | Turns: ${result.turns} | ${(result.duration / 1000).toFixed(1)}s`);
  });

program
  .command('architect')
  .description('Analizar codebase y generar plan de implementación')
  .argument('<taskTitle>', 'Título de la tarea')
  .option('--cwd <path>', 'Directorio del repo', process.cwd())
  .action(async (taskTitle, opts) => {
    const task = {
      taskId: 'manual',
      title: taskTitle,
      acceptanceCriteria: ['Implementación funcional'],
      devPoints: 3,
    };

    console.log(`Architect analyzing for: ${taskTitle}...`);
    const result = await runArchitect(task, '', { cwd: opts.cwd });

    if (!result.success) {
      console.error('Architect failed:', result.error);
      if (result.raw) console.error('Raw:', result.raw);
      process.exit(1);
    }

    console.log('\n✓ Plan generated:');
    console.log(JSON.stringify(result.plan, null, 2));
    console.log(`\nCost: $${result.cost?.toFixed(4)} | Turns: ${result.turns} | ${(result.duration / 1000).toFixed(1)}s`);
  });

program.parse();
