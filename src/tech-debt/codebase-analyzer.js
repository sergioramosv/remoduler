import { execSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { logger } from '../utils/logger.js';

const JS_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

/**
 * Analyzes a codebase for dead code and unused imports.
 * @param {string} cwd
 * @returns {{ unusedImports: string[], potentialDeadCode: string[], summary: string }}
 */
export function analyzeCodebase(cwd) {
  logger.info('Analyzing codebase for dead code and unused imports...', 'CODEBASE_ANALYZER');

  const files = collectFiles(cwd);
  const unusedImports = [];
  const potentialDeadCode = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf8');
      const relPath = file.replace(cwd, '').replace(/\\/g, '/');

      // Detect unused imports (imported but never used in the file)
      const importMatches = content.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]/g);
      for (const match of importMatches) {
        const imports = match[1].split(',').map(s => s.trim().split(' as ').pop().trim());
        for (const imp of imports) {
          if (imp && !isUsedInFile(content, imp, match[0])) {
            unusedImports.push(`${relPath}: unused import '${imp}'`);
          }
        }
      }

      // Detect exported but never-used functions (simple heuristic)
      const exportMatches = content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g);
      for (const match of exportMatches) {
        const fnName = match[1];
        if (fnName !== 'default' && !isUsedAcrossFiles(files, fnName, file)) {
          potentialDeadCode.push(`${relPath}: possibly unused export '${fnName}'`);
        }
      }
    } catch { /* skip unreadable files */ }
  }

  const summary = `Found ${unusedImports.length} unused imports, ${potentialDeadCode.length} potentially unused exports`;
  logger.info(summary, 'CODEBASE_ANALYZER');

  return { unusedImports, potentialDeadCode, summary };
}

function collectFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (IGNORE_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) results.push(...collectFiles(full));
      else if (JS_EXTENSIONS.includes(extname(entry))) results.push(full);
    }
  } catch { /* skip */ }
  return results;
}

function isUsedInFile(content, name, importStatement) {
  const withoutImport = content.replace(importStatement, '');
  const regex = new RegExp(`\\b${name}\\b`);
  return regex.test(withoutImport);
}

function isUsedAcrossFiles(files, name, sourceFile) {
  const regex = new RegExp(`\\b${name}\\b`);
  for (const file of files) {
    if (file === sourceFile) continue;
    try {
      const content = readFileSync(file, 'utf8');
      if (regex.test(content)) return true;
    } catch { /* skip */ }
  }
  return false;
}
