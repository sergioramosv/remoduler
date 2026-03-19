/**
 * Detecta tareas multi-parte como "(2/4)" y bloquea partes posteriores
 * si las anteriores no están completadas.
 */

const PART_PATTERNS = [
  /\((\d+)\/(\d+)\)/,
  /\(Part\s+(\d+)\s+of\s+(\d+)\)/i,
  /\[(\d+)\/(\d+)\]/,
  /\((\d+)\s+of\s+(\d+)\)/i,
];

/**
 * Devuelve IDs de partes anteriores no completadas.
 * Si retorna array vacío, la tarea no está bloqueada.
 */
export function getUnresolvedPreviousParts(task, allTasks) {
  for (const pattern of PART_PATTERNS) {
    const match = task.title.match(pattern);
    if (!match) continue;

    const currentPart = parseInt(match[1]);
    if (currentPart <= 1) return []; // Part 1 nunca bloqueada

    const baseTitle = task.title.replace(pattern, '').trim();
    const unresolved = [];

    for (let i = 1; i < currentPart; i++) {
      const prevTask = allTasks.find(t => {
        const prevMatch = t.title.match(pattern);
        if (!prevMatch) return false;
        const prevBase = t.title.replace(pattern, '').trim();
        return prevBase === baseTitle && parseInt(prevMatch[1]) === i;
      });

      if (!prevTask || prevTask.status !== 'done') {
        unresolved.push(prevTask?.id || `part-${i}-missing`);
      }
    }

    return unresolved;
  }

  return [];
}
