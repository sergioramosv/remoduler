import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { logger } from '../utils/logger.js';

export const STYLE_RULES = 'obligatory';

const MAX_SAMPLE_FILES = 10;
const MAX_LINES_FOR_SPACING = 50;

export async function detectStyle(targetDir = 'src/') {
  try {
    const sampleFiles = await getSampleFiles(targetDir);
    if (sampleFiles.length === 0) {
      return { rules: [] };
    }

    const contents = await Promise.all(
      sampleFiles.map(f => readFile(f, 'utf-8').catch(() => ''))
    );

    const rules = [
      detectNaming(contents),
      detectSpacing(contents),
      detectImports(contents),
      detectSemicolons(contents),
      detectQuotes(contents),
    ].filter(Boolean);

    logger.info(`Detected ${rules.length} style rules from ${sampleFiles.length} files`, 'INTELLIGENCE');
    return { rules };
  } catch (err) {
    logger.error(`Failed to detect style: ${err.message}`, 'INTELLIGENCE');
    return { rules: [] };
  }
}

async function getSampleFiles(dir, files = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (files.length >= MAX_SAMPLE_FILES) break;
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await getSampleFiles(fullPath, files);
    } else if (extname(entry.name) === '.js') {
      files.push(fullPath);
    }
  }

  return files;
}

function detectNaming(contents) {
  let camelCount = 0;
  let snakeCount = 0;

  for (const content of contents) {
    const funcMatches = content.match(/(?:function|const|let|var)\s+([a-z]\w+)/g) || [];
    for (const m of funcMatches) {
      const name = m.replace(/(?:function|const|let|var)\s+/, '');
      if (name.includes('_') && name !== name.toUpperCase()) snakeCount++;
      else if (/[a-z][A-Z]/.test(name)) camelCount++;
    }
  }

  const total = camelCount + snakeCount;
  if (total === 0) return null;

  const value = camelCount >= snakeCount ? 'camelCase' : 'snake_case';
  const confidence = Math.max(camelCount, snakeCount) / total;

  return { rule: 'naming', value, confidence: Math.round(confidence * 100) / 100, enforcement: STYLE_RULES };
}

function detectSpacing(contents) {
  let spacesCount = 0;
  let tabsCount = 0;
  let indentSizes = [];

  for (const content of contents) {
    const lines = content.split('\n').slice(0, MAX_LINES_FOR_SPACING);
    for (const line of lines) {
      const spaceMatch = line.match(/^( +)\S/);
      const tabMatch = line.match(/^(\t+)\S/);
      if (spaceMatch) {
        spacesCount++;
        indentSizes.push(spaceMatch[1].length);
      }
      if (tabMatch) tabsCount++;
    }
  }

  const type = spacesCount >= tabsCount ? 'spaces' : 'tabs';
  const indentSize = indentSizes.length > 0
    ? mode(indentSizes.filter(s => s <= 8))
    : 2;

  const total = spacesCount + tabsCount;
  const confidence = total > 0 ? Math.max(spacesCount, tabsCount) / total : 0;

  return { rule: 'spacing', value: `${type}:${indentSize}`, confidence: Math.round(confidence * 100) / 100, enforcement: STYLE_RULES };
}

function detectImports(contents) {
  let esmCount = 0;
  let cjsCount = 0;

  for (const content of contents) {
    const esmMatches = content.match(/\b(import|export)\s/g) || [];
    const cjsMatches = content.match(/\b(require|module\.exports)\b/g) || [];
    esmCount += esmMatches.length;
    cjsCount += cjsMatches.length;
  }

  const total = esmCount + cjsCount;
  if (total === 0) return null;

  const value = esmCount >= cjsCount ? 'ESM' : 'CJS';
  const confidence = Math.max(esmCount, cjsCount) / total;

  return { rule: 'imports', value, confidence: Math.round(confidence * 100) / 100, enforcement: STYLE_RULES };
}

function detectSemicolons(contents) {
  let withSemi = 0;
  let withoutSemi = 0;

  for (const content of contents) {
    const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('//'));
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed.endsWith(';')) withSemi++;
      else if (/\w/.test(trimmed) && !trimmed.endsWith('{') && !trimmed.endsWith('}') && !trimmed.endsWith(',') && !trimmed.endsWith('(')) {
        withoutSemi++;
      }
    }
  }

  const total = withSemi + withoutSemi;
  if (total === 0) return null;

  const value = withSemi >= withoutSemi ? 'always' : 'never';
  const confidence = Math.max(withSemi, withoutSemi) / total;

  return { rule: 'semicolons', value, confidence: Math.round(confidence * 100) / 100, enforcement: STYLE_RULES };
}

function detectQuotes(contents) {
  let singleCount = 0;
  let doubleCount = 0;

  for (const content of contents) {
    const singles = content.match(/(?:^|[\s=:(,])(')/gm) || [];
    const doubles = content.match(/(?:^|[\s=:(,])(")/gm) || [];
    singleCount += singles.length;
    doubleCount += doubles.length;
  }

  const total = singleCount + doubleCount;
  if (total === 0) return null;

  const value = singleCount >= doubleCount ? 'single' : 'double';
  const confidence = Math.max(singleCount, doubleCount) / total;

  return { rule: 'quotes', value, confidence: Math.round(confidence * 100) / 100, enforcement: STYLE_RULES };
}

function mode(arr) {
  if (arr.length === 0) return 2;
  const freq = {};
  for (const v of arr) freq[v] = (freq[v] || 0) + 1;
  return Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
}
