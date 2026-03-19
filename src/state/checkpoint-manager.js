import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const DIR = '.remoduler/checkpoints';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Guarda/restaura estado de tareas para recovery de rate limits o fallos.
 */
class CheckpointManager {
  #root;
  constructor(root = process.cwd()) { this.#root = root; }

  get dir() { return join(this.#root, DIR); }

  async save(data) {
    await fs.mkdir(this.dir, { recursive: true });
    const entry = { ...data, savedAt: Date.now() };
    const file = `cp-${data.taskId || 'unknown'}-${Date.now()}.json`;
    await fs.writeFile(join(this.dir, file), JSON.stringify(entry, null, 2));
    return file;
  }

  async list() {
    try {
      const files = await fs.readdir(this.dir);
      const items = [];
      for (const f of files.filter(f => f.endsWith('.json'))) {
        try {
          const raw = await fs.readFile(join(this.dir, f), 'utf8');
          items.push({ ...JSON.parse(raw), _file: f });
        } catch {}
      }
      return items.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    } catch { return []; }
  }

  async getLatest() { return (await this.list())[0] || null; }

  isValid(cp) {
    if (!cp?.savedAt || !cp?.taskId) return false;
    return Date.now() - cp.savedAt < MAX_AGE_MS;
  }

  async remove(cp) {
    if (!cp?._file) return;
    try { await fs.unlink(join(this.dir, cp._file)); } catch {}
  }

  async clear() {
    try {
      for (const f of await fs.readdir(this.dir)) await fs.unlink(join(this.dir, f));
    } catch {}
  }
}

export { CheckpointManager };
export const checkpointManager = new CheckpointManager();
