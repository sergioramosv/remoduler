import { getDb } from '../firebase.js';
import { config } from '../config.js';

/**
 * Focus Manager — mantiene en qué fase está trabajando remoduler.
 * Persiste en Firebase para sobrevivir entre sesiones.
 *
 * Lógica:
 * - Si hay focus activo (ej: "9"), solo trabaja en tareas [9.x]
 * - Dentro de la fase, sigue orden numérico (9.1 → 9.2 → 9.3)
 * - Cuando termina todas las tareas de la fase, limpia el focus
 */

const projectId = () => config.defaultProjectId;

export async function getFocus() {
  try {
    // Check CLI-set focus first
    const snap = await getDb().ref(`remoduler/${projectId()}/focus`).once('value');
    const cliFocus = snap.val();
    if (cliFocus?.phase) return cliFocus;

    // Check dashboard settings focus
    const settingsSnap = await getDb().ref(`remoduler/${projectId()}/settings/focusPhase`).once('value');
    const dashFocus = settingsSnap.val();
    if (dashFocus) return { phase: String(dashFocus), setAt: Date.now() };

    return null;
  } catch { return null; }
}

export async function setFocus(phase) {
  try {
    await getDb().ref(`remoduler/${projectId()}/focus`).set({
      phase: String(phase),
      setAt: Date.now(),
    });
  } catch {}
}

export async function clearFocus() {
  try {
    await getDb().ref(`remoduler/${projectId()}/focus`).remove();
  } catch {}
}

/**
 * Extrae el número de fase y sub-fase del título de una tarea.
 * "[9.3] Crear algo" → { phase: "9", sub: 3, full: "9.3" }
 * "[12.1] Otra cosa" → { phase: "12", sub: 1, full: "12.1" }
 * "Sin formato" → null
 */
export function parseTaskPhase(title) {
  const match = title.match(/^\[(\d+)\.(\d+)\]/);
  if (!match) return null;
  return {
    phase: match[1],
    sub: parseInt(match[2]),
    full: `${match[1]}.${match[2]}`,
  };
}
