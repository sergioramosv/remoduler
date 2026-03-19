import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';

let db = null;

export function getDb() {
  if (db) return db;

  const serviceAccount = JSON.parse(
    readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf-8')
  );

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }

  db = admin.database();
  return db;
}

/**
 * Lee todas las tareas to-do de un proyecto, ordenadas por prioridad.
 */
export async function getTasks(projectId, status = 'to-do') {
  const snapshot = await getDb()
    .ref('tasks')
    .orderByChild('projectId')
    .equalTo(projectId)
    .once('value');

  const data = snapshot.val();
  if (!data) return [];

  return Object.entries(data)
    .map(([id, val]) => ({ id, ...val }))
    .filter(t => t.status === status)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/**
 * Cambia el estado de una tarea en Firebase.
 */
export async function changeTaskStatus(taskId, newStatus) {
  const userId = process.env.DEFAULT_USER_ID || '';
  const userName = process.env.DEFAULT_USER_NAME || 'Remoduler';

  await getDb().ref(`tasks/${taskId}`).update({
    status: newStatus,
    updatedAt: Date.now(),
  });

  // Add history entry
  const historyRef = getDb().ref(`tasks/${taskId}/history`).push();
  await historyRef.set({
    id: historyRef.key,
    action: 'update',
    field: 'status',
    oldValue: null, // we don't track old value here for simplicity
    newValue: newStatus,
    timestamp: Date.now(),
    userId,
    userName,
  });
}

/**
 * Cierra la conexión con Firebase.
 */
export async function closeDb() {
  if (admin.apps.length) {
    await admin.app().delete();
    db = null;
  }
}
