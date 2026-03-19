import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { getDb } from '../firebase.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Sanitiza un string para usarlo como key de Firebase.
 * Firebase no permite: . # $ / [ ]
 */
function sanitizeKey(str) {
  return str.replace(/[.#$\/\[\]]/g, '_');
}

/**
 * Knowledge Graph — almacena y recupera conocimiento scoped por module/file path.
 * Tipos: coderBrief, reviewerBrief, moduleLessons, testingPatterns.
 * Dual storage: JSON local (.remoduler/knowledge/) + Firebase.
 */
export class KnowledgeGraph {
  /**
   * Añade una entry al knowledge graph.
   * @param {string} projectId
   * @param {string} scope - module/file path
   * @param {'coderBrief'|'reviewerBrief'|'moduleLessons'|'testingPatterns'} type
   * @param {object} data
   */
  async addEntry(projectId, scope, type, data) {
    const entry = {
      type,
      data,
      createdAt: new Date().toISOString(),
    };

    const results = await Promise.allSettled([
      this._saveLocal(projectId, scope, entry),
      this._saveFirebase(projectId, scope, entry),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') {
        logger.warn(`Knowledge save failed: ${r.reason?.message}`, 'KNOWLEDGE');
      }
    }
  }

  /**
   * Recupera entries filtradas por scope y opcionalmente tipo.
   * @param {string} projectId
   * @param {string} scope
   * @param {string} [type]
   * @returns {Promise<Array>}
   */
  async getEntries(projectId, scope, type) {
    let entries = await this._loadLocal(projectId, scope);

    if (!entries.length) {
      entries = await this._loadFirebase(projectId, scope);
    }

    if (type) {
      return entries.filter(e => e.type === type);
    }
    return entries;
  }

  /**
   * Dado un array de file paths, retorna todas las lessons relevantes
   * matching por path exacto o directorio padre.
   * @param {string} projectId
   * @param {string[]} filePaths
   * @returns {Promise<Array>}
   */
  async loadLessonsForFiles(projectId, filePaths) {
    if (!filePaths?.length) return [];

    const scopes = new Set();
    for (const fp of filePaths) {
      if (typeof fp === 'string') {
        scopes.add(fp);
        // Also add parent directory as scope
        const dir = dirname(fp);
        if (dir && dir !== '.') scopes.add(dir);
      } else if (typeof fp === 'object' && fp?.path) {
        scopes.add(fp.path);
        const dir = dirname(fp.path);
        if (dir && dir !== '.') scopes.add(dir);
      }
    }

    const all = [];
    for (const scope of scopes) {
      try {
        const entries = await this.getEntries(projectId, scope);
        all.push(...entries);
      } catch {
        // skip failed scopes
      }
    }
    return all;
  }

  /**
   * Registra un pattern de review exitoso.
   * @param {string} projectId
   * @param {string} scope
   * @param {object} reviewData - { cycles, score, filesChanged, etc. }
   */
  async recordSuccessfulReview(projectId, scope, reviewData) {
    await this.addEntry(projectId, scope, 'testingPatterns', {
      reviewOutcome: 'approved',
      ...reviewData,
    });
  }

  /**
   * Guarda una entry en storage local JSON.
   */
  async _saveLocal(projectId, scope, entry) {
    const filePath = this._localPath(projectId, scope);
    await mkdir(dirname(filePath), { recursive: true });

    let entries = [];
    try {
      const raw = await readFile(filePath, 'utf-8');
      entries = JSON.parse(raw);
    } catch {
      // file doesn't exist yet
    }

    entries.push(entry);

    // FIFO limit
    const max = config.knowledgeMaxEntries || 200;
    if (entries.length > max) {
      entries = entries.slice(entries.length - max);
    }

    await writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  /**
   * Guarda una entry en Firebase.
   */
  async _saveFirebase(projectId, scope, entry) {
    try {
      const key = sanitizeKey(scope);
      const ref = getDb().ref(`intelligence/${projectId}/knowledge/${key}`);
      const snapshot = await ref.once('value');
      let entries = snapshot.val() || [];

      entries.push(entry);

      const max = config.knowledgeMaxEntries || 200;
      if (entries.length > max) {
        entries = entries.slice(entries.length - max);
      }

      await ref.set(entries);
    } catch (err) {
      logger.warn(`Firebase knowledge save failed: ${err.message}`, 'KNOWLEDGE');
    }
  }

  /**
   * Carga entries desde storage local JSON.
   */
  async _loadLocal(projectId, scope) {
    try {
      const filePath = this._localPath(projectId, scope);
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /**
   * Carga entries desde Firebase.
   */
  async _loadFirebase(projectId, scope) {
    try {
      const key = sanitizeKey(scope);
      const ref = getDb().ref(`intelligence/${projectId}/knowledge/${key}`);
      const snapshot = await ref.once('value');
      return snapshot.val() || [];
    } catch {
      return [];
    }
  }

  /**
   * Genera la ruta local para un scope dado.
   */
  _localPath(projectId, scope) {
    const dir = config.knowledgeLocalDir || '.remoduler/knowledge';
    const fileName = sanitizeKey(scope) + '.json';
    return join(dir, projectId, fileName);
  }
}

export const knowledgeGraph = new KnowledgeGraph();
