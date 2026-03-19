/**
 * Remoduler MCP Tools
 *
 * 8 tools para orquestar agentes IA:
 *
 * Paso a paso:
 *   1. remoduler_plan     → Planner elige tarea
 *   2. remoduler_code     → Architect + Coder implementa
 *   3. remoduler_review   → Reviewer revisa PR
 *   4. remoduler_fix      → Coder arregla issues
 *   5. remoduler_finalize → Merge/close PR + actualizar tarea
 *
 * Ciclo completo:
 *   6. remoduler_run      → Ejecuta N tareas completas
 *
 * Recovery:
 *   7. remoduler_resume   → Reanuda desde checkpoint
 *
 * Info:
 *   8. remoduler_status   → Config + budget actual
 */

import { z } from 'zod';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = process.env.REMODULER_ROOT || resolve(__dirname, '..', '..', '..');

// Dynamic imports
const { runPlanner } = await import(`${ROOT_DIR}/src/agents/planner.js`);
const { runArchitect } = await import(`${ROOT_DIR}/src/agents/architect.js`);
const { runCoder, runCoderFix } = await import(`${ROOT_DIR}/src/agents/coder.js`);
const { runReviewer } = await import(`${ROOT_DIR}/src/agents/reviewer.js`);
const { run, resume } = await import(`${ROOT_DIR}/src/orchestrator.js`);
const { config, validateConfig } = await import(`${ROOT_DIR}/src/config.js`);
const { budgetManager } = await import(`${ROOT_DIR}/src/cost/budget-manager.js`);
const { changeTaskStatus } = await import(`${ROOT_DIR}/src/firebase.js`);
const { logger } = await import(`${ROOT_DIR}/src/utils/logger.js`);

// gh CLI helper
let runGh = null;
try {
  const ghCli = await import(`${ROOT_DIR}/skills/github-mcp/src/gh-cli.js`);
  runGh = ghCli.runGh;
} catch {}

function extractOwnerRepo(url) {
  if (!url) return '';
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  return match ? match[1].replace(/\.git$/, '') : url;
}

export const tools = {

  // ═══ 1. PLAN ═══
  remoduler_plan: {
    description: 'Ejecuta el agente PLANNER: selecciona la siguiente tarea del backlog, la marca in-progress. Después usa remoduler_code.',
    schema: {
      projectId: z.string().optional().describe('Project ID. Default: DEFAULT_PROJECT_ID del .env.'),
    },
    handler: async ({ projectId }) => {
      const pid = projectId || config.defaultProjectId;
      if (!pid) throw new Error('projectId requerido.');

      const result = await runPlanner({
        projectId: pid,
        userId: config.defaultUserId,
        userName: config.defaultUserName || 'Remoduler',
      });

      if (!result.success) return { success: false, error: result.error };

      if (result.empty) return { success: true, task: null, message: result.message };

      return {
        success: true,
        task: {
          taskId: result.taskId,
          title: result.title,
          description: result.description,
          branchName: result.branchName,
          repoUrl: result.repoUrl,
          devPoints: result.devPoints,
          sprintId: result.sprintId,
          acceptanceCriteria: result.acceptanceCriteria,
          userStory: result.userStory,
        },
        cost: result.cost,
        tokens: result.tokens,
        nextStep: 'Usa remoduler_code con los datos de task.',
      };
    },
  },

  // ═══ 2. CODE ═══
  remoduler_code: {
    description: 'Ejecuta ARCHITECT + CODER: analiza codebase, implementa código, crea branch y abre PR. Después usa remoduler_review.',
    schema: {
      taskId: z.string().describe('ID de la tarea'),
      title: z.string().describe('Título de la tarea'),
      branchName: z.string().describe('Nombre de la branch'),
      repoUrl: z.string().describe('URL del repo GitHub'),
      acceptanceCriteria: z.array(z.string()).optional().describe('Criterios de aceptación'),
      devPoints: z.number().optional().describe('Dev points'),
      cwd: z.string().optional().describe('Directorio del repo'),
    },
    handler: async (params) => {
      const task = {
        taskId: params.taskId,
        title: params.title,
        branchName: params.branchName,
        repoUrl: params.repoUrl,
        acceptanceCriteria: params.acceptanceCriteria || [],
        devPoints: params.devPoints || 0,
      };

      // Architect
      const archResult = await runArchitect(task, params.repoUrl, { cwd: params.cwd });
      const plan = archResult.success ? archResult.plan : null;

      // Coder
      const codeResult = await runCoder(task, plan, params.branchName, params.repoUrl);

      if (!codeResult.success) {
        return { success: false, error: codeResult.error, rateLimited: codeResult.rateLimited };
      }

      return {
        success: true,
        pr: {
          prNumber: codeResult.prNumber,
          prUrl: codeResult.prUrl,
          branchName: codeResult.branchName,
          filesChanged: codeResult.filesChanged,
        },
        repo: extractOwnerRepo(params.repoUrl),
        architectCost: archResult.cost,
        coderCost: codeResult.cost,
        nextStep: `Usa remoduler_review con prNumber=${codeResult.prNumber}.`,
      };
    },
  },

  // ═══ 3. REVIEW ═══
  remoduler_review: {
    description: 'Ejecuta el REVIEWER: revisa PR con 8 criterios. Si APPROVED → remoduler_finalize. Si REQUEST_CHANGES → remoduler_fix.',
    schema: {
      prNumber: z.number().describe('Número de la PR'),
      prUrl: z.string().describe('URL de la PR'),
      taskId: z.string().describe('ID de la tarea'),
      taskTitle: z.string().describe('Título de la tarea'),
      branchName: z.string().describe('Branch de la PR'),
      acceptanceCriteria: z.array(z.string()).optional().describe('Criterios de aceptación'),
    },
    handler: async (params) => {
      const task = {
        taskId: params.taskId,
        title: params.taskTitle,
        acceptanceCriteria: params.acceptanceCriteria || [],
      };

      const result = await runReviewer(task, params.prUrl, params.branchName);

      if (!result.success) return { success: false, error: result.error };

      return {
        success: true,
        verdict: result.verdict,
        score: result.score,
        issues: result.issues,
        positives: result.positives,
        summary: result.summary,
        cost: result.cost,
        tokens: result.tokens,
        nextStep: result.verdict === 'APPROVED'
          ? `PR aprobada (score: ${result.score}). Usa remoduler_finalize con approved=true.`
          : `${result.issues.length} issues encontrados. Usa remoduler_fix para corregir.`,
      };
    },
  },

  // ═══ 4. FIX ═══
  remoduler_fix: {
    description: 'Ejecuta el CODER en modo fix: arregla issues del Reviewer, pushea al mismo branch. Después usa remoduler_review de nuevo.',
    schema: {
      taskId: z.string().describe('ID de la tarea'),
      taskTitle: z.string().describe('Título de la tarea'),
      branchName: z.string().describe('Branch de la PR'),
      reviewIssues: z.array(z.object({
        severity: z.string(),
        description: z.string(),
        file: z.string().optional(),
        suggestion: z.string().optional(),
      })).describe('Issues del reviewer a corregir'),
    },
    handler: async (params) => {
      const task = { taskId: params.taskId, title: params.taskTitle };

      const result = await runCoderFix(task, params.branchName, params.reviewIssues);

      if (!result.success) return { success: false, error: result.error };

      return {
        success: true,
        fixed: result.fixed,
        issuesResolved: result.issuesResolved,
        issuesNotResolved: result.issuesNotResolved,
        filesChanged: result.filesChanged,
        cost: result.cost,
        tokens: result.tokens,
        nextStep: 'Usa remoduler_review de nuevo para re-revisar.',
      };
    },
  },

  // ═══ 5. FINALIZE ═══
  remoduler_finalize: {
    description: 'Mergea o cierra la PR y actualiza el estado de la tarea en planning-task.',
    schema: {
      taskId: z.string().describe('ID de la tarea'),
      prNumber: z.number().describe('Número de la PR'),
      repo: z.string().describe('Repo en formato owner/repo'),
      approved: z.boolean().describe('true si aprobada, false para cerrar'),
    },
    handler: async ({ taskId, prNumber, repo, approved }) => {
      if (!approved) {
        if (runGh) {
          try { runGh(['pr', 'close', String(prNumber), '--repo', repo, '--delete-branch']); } catch {}
        }
        try { await changeTaskStatus(taskId, 'to-do'); } catch {}
        return { success: true, action: 'closed', merged: false, taskStatus: 'to-do' };
      }

      let merged = false;
      if (config.autoMerge && runGh) {
        try {
          runGh(['pr', 'merge', String(prNumber), '--repo', repo, '--squash', '--delete-branch']);
          merged = true;
        } catch (err) {
          return { success: false, error: `Merge failed: ${err.message}` };
        }
      }

      try { await changeTaskStatus(taskId, 'to-validate'); } catch {}

      return {
        success: true,
        action: merged ? 'merged' : 'pending-merge',
        merged,
        taskStatus: 'to-validate',
        message: merged
          ? `PR #${prNumber} mergeada (squash). Tarea → to-validate.`
          : `AUTO_MERGE=false. PR aprobada, merge manual pendiente.`,
      };
    },
  },

  // ═══ 6. RUN ═══
  remoduler_run: {
    description: 'Ejecuta el pipeline completo para N tareas: Plan → Architect → Code → Test → Review → Merge.',
    schema: {
      projectId: z.string().optional().describe('Project ID. Default: .env'),
      tasks: z.number().optional().describe('Número de tareas. Default: 1. 0 = continuo.'),
      cwd: z.string().optional().describe('Directorio del repo'),
    },
    handler: async (params) => {
      const pid = params.projectId || config.defaultProjectId;
      if (!pid) throw new Error('projectId requerido.');

      return await run(pid, {
        tasks: params.tasks ?? 1,
        cwd: params.cwd,
      });
    },
  },

  // ═══ 7. RESUME ═══
  remoduler_resume: {
    description: 'Reanuda desde el último checkpoint (rate limit recovery).',
    schema: {
      cwd: z.string().optional().describe('Directorio del repo'),
    },
    handler: async (params) => {
      const result = await resume({ cwd: params.cwd });
      if (!result) return { success: true, resumed: false, message: 'No checkpoints pendientes.' };
      return { success: true, resumed: true, result };
    },
  },

  // ═══ 8. STATUS ═══
  remoduler_status: {
    description: 'Config actual, estado del budget (coste + tokens) y validación.',
    schema: {},
    handler: async () => {
      const { valid, issues } = validateConfig();
      const budget = budgetManager.initialized ? budgetManager.getStatus() : null;

      return {
        config: {
          cliPlanner: config.cliPlanner,
          cliCoder: config.cliCoder,
          cliReviewer: config.cliReviewer,
          defaultProjectId: config.defaultProjectId || '(no configurado)',
          autoMerge: config.autoMerge,
          maxReviewCycles: config.maxReviewCycles,
          dailyBudgetUsd: config.dailyBudgetUsd,
        },
        budget,
        valid,
        issues: issues.length > 0 ? issues : undefined,
      };
    },
  },
};
