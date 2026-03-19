import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, push, set, DatabaseReference } from 'firebase/database';

const firebaseConfig = {
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || 'https://planning-task-default-rtdb.europe-west1.firebasedatabase.app',
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, onValue, push, set };
export type { DatabaseReference };
