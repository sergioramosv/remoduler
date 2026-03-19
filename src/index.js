#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { Command } from 'commander';
import { run, resume, checkForPendingCheckpoints } from './orchestrator.js';
import { runPlanner } from './agents/planner.js';
import { runArchitect } from './agents/architect.js';
import { config, validateConfig } from './config.js';

const program = new Command();

program
  .name('remoduler')
  .description('Orquestador de agentes IA autonomo')
  .version('1.0.0');

// --- remoduler run ---
program
  .command('run')
  .description('Ejecutar el pipeline completo: Plan → Architect → Code → Test → Review')
  .option('-p, --project <id>', 'Project ID')
  .option('-t, --tasks <n>', 'Número de tareas a ejecutar (0 = infinito)', '1')
  .option('--cwd <path>', 'Directorio del repo target', process.cwd())
  .action(async (opts) => {
    const projectId = opts.project || config.defaultProjectId;
    if (!projectId) {
      console.error('No project ID. Set DEFAULT_PROJECT_ID in .env or use -p <id>');
      process.exit(1);
    }

    await checkForPendingCheckpoints();
    await run(projectId, {
      tasks: parseInt(opts.tasks),
      cwd: opts.cwd,
    });
  });

// --- remoduler resume ---
program
  .command('resume')
  .description('Reanudar desde el último checkpoint (rate limit recovery)')
  .option('--cwd <path>', 'Directorio del repo target', process.cwd())
  .action(async (opts) => {
    const result = await resume({ cwd: opts.cwd });
    if (!result) {
      console.log('Nothing to resume.');
    }
  });

// --- remoduler plan ---
program
  .command('plan')
  .description('Seleccionar la mejor tarea del backlog (solo planificar, no ejecutar)')
  .option('-p, --project <id>', 'Project ID')
  .action(async (opts) => {
    const projectId = opts.project || config.defaultProjectId;
    const userId = config.defaultUserId;
    const userName = config.defaultUserName || 'Remoduler';

    if (!projectId) {
      console.error('No project ID. Set DEFAULT_PROJECT_ID in .env or use -p <id>');
      process.exit(1);
    }

    console.log(`Planning for project ${projectId}...`);
    const result = await runPlanner({ projectId, userId, userName });

    if (!result.success) {
      console.error('Planner failed:', result.error);
      process.exit(1);
    }

    if (result.empty) {
      console.log(result.message);
      return;
    }

    console.log(`\nSelected task:`);
    console.log(`  ID:       ${result.taskId}`);
    console.log(`  Title:    ${result.title}`);
    console.log(`  Branch:   ${result.branchName}`);
    console.log(`  Repo:     ${result.repoUrl}`);
    console.log(`  Points:   ${result.devPoints}`);
    console.log(`  Sprint:   ${result.sprintId || 'none'}`);
    console.log(`  Reason:   ${result.reason}`);
    console.log(`\n  Cost: $${result.cost?.toFixed(4)} | Turns: ${result.turns} | ${(result.duration / 1000).toFixed(1)}s`);
  });

// --- remoduler architect ---
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

    console.log(`Architect analyzing: ${taskTitle}...`);
    const result = await runArchitect(task, '', { cwd: opts.cwd });

    if (!result.success) {
      console.error('Architect failed:', result.error);
      process.exit(1);
    }

    console.log('\nPlan:');
    console.log(JSON.stringify(result.plan, null, 2));
    console.log(`\nCost: $${result.cost?.toFixed(4)} | Turns: ${result.turns} | ${(result.duration / 1000).toFixed(1)}s`);
  });

// --- remoduler doctor ---
program
  .command('doctor')
  .description('Verificar configuración y dependencias')
  .action(() => {
    const { valid, issues } = validateConfig();
    if (valid) {
      console.log('All checks passed.');
    } else {
      console.log('Issues found:');
      issues.forEach(i => console.log(`  - ${i}`));
      process.exit(1);
    }
  });

// --- remoduler setup ---
program
  .command('setup')
  .description('Configurar remoduler (generar .env)')
  .action(async () => {
    const { runSetup } = await import('./setup.js');
    await runSetup();
  });

program.parse();
