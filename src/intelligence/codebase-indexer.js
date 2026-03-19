import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const INDEX_CACHE_TTL = config.intelligenceCacheTtl ?? 300000;
export const MAX_CHARS = config.intelligenceMaxChars ?? 2000;

const cache = new Map();

export function clearIndexCache() {
  cache.clear();
}

export async function indexCodebase(targetDir = 'src/') {
  const cached = cache.get(targetDir);
  if (cached && Date.now() - cached.timestamp < INDEX_CACHE_TTL) {
    return cached.data;
  }

  try {
    const files = await scanDir(targetDir);
    const structure = buildTree(files, targetDir);
    const totalLines = files.reduce((sum, f) => sum + f.lines, 0);

    const summary = {
      files,
      structure,
      totalFiles: files.length,
      totalLines,
    };

    const truncated = truncateToMaxLength(summary, MAX_CHARS);

    cache.set(targetDir, { data: truncated, timestamp: Date.now() });
    logger.info(`Indexed ${files.length} files (${totalLines} lines) from ${targetDir}`, 'INTELLIGENCE');
    return truncated;
  } catch (err) {
    logger.error(`Failed to index codebase at ${targetDir}: ${err.message}`, 'INTELLIGENCE');
    return { files: [], structure: '', totalFiles: 0, totalLines: 0 };
  }
}

async function scanDir(dir, fileList = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return fileList;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      await scanDir(fullPath, fileList);
    } else if (extname(entry.name) === '.js') {
      try {
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n').length;
        const exports = extractExports(content);
        const imports = extractImports(content);
        fileList.push({ path: fullPath, exports, imports, lines });
      } catch {
        // skip unreadable files
      }
    }
  }

  return fileList;
}

function extractExports(content) {
  const matches = content.match(/export\s+(?:const|function|class|let|var)\s+(\w+)/g) || [];
  return matches.map(m => m.replace(/export\s+(?:const|function|class|let|var)\s+/, ''));
}

function extractImports(content) {
  const matches = content.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g) || [];
  return matches.map(m => {
    const fromMatch = m.match(/from\s+['"]([^'"]+)['"]/);
    return fromMatch ? fromMatch[1] : '';
  }).filter(Boolean);
}

function buildTree(files, baseDir) {
  return files.map(f => relative(baseDir, f.path)).sort().join('\n');
}

function truncateToMaxLength(summary, maxChars) {
  const json = JSON.stringify(summary);
  if (json.length <= maxChars) return summary;

  // Truncate files list to fit within character limit
  const truncated = { ...summary, files: [] };
  let currentLength = JSON.stringify(truncated).length;

  for (const file of summary.files) {
    const fileJson = JSON.stringify(file);
    if (currentLength + fileJson.length + 1 > maxChars) break;
    truncated.files.push(file);
    currentLength += fileJson.length + 1;
  }

  return truncated;
}
