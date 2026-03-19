import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { config } from './config.js';

let db = null;

export function getDb() {
  if (db) return db;

  const serviceAccount = JSON.parse(readFileSync(config.serviceAccountPath, 'utf-8'));

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: config.databaseURL,
    });
  }

  db = admin.database();
  return db;
}

// Strip undefined/null values recursively before writing to Firebase
function sanitize(obj) {
  if (Array.isArray(obj)) return obj.map(sanitize).filter(v => v !== undefined);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, sanitize(v)])
    );
  }
  return obj;
}

// --- Generic helpers ---

export async function getAll(path) {
  const snapshot = await getDb().ref(path).once('value');
  const data = snapshot.val();
  if (!data) return [];
  return Object.entries(data).map(([id, val]) => ({ id, ...val }));
}

export async function getById(path, id) {
  const snapshot = await getDb().ref(`${path}/${id}`).once('value');
  const data = snapshot.val();
  if (!data) return null;
  return { id, ...data };
}

export async function getFiltered(path, field, value) {
  const snapshot = await getDb().ref(path).orderByChild(field).equalTo(value).once('value');
  const data = snapshot.val();
  if (!data) return [];
  return Object.entries(data).map(([id, val]) => ({ id, ...val }));
}

export async function create(path, data) {
  const ref = getDb().ref(path).push();
  const id = ref.key;
  await ref.set(sanitize({ ...data, id }));
  return id;
}

export async function update(path, id, data) {
  await getDb().ref(`${path}/${id}`).update(sanitize(data));
}

export async function remove(path, id) {
  await getDb().ref(`${path}/${id}`).remove();
}
