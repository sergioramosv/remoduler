import { existsSync } from 'fs';

export const config = {
  serviceAccountPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  databaseURL: process.env.FIREBASE_DATABASE_URL || '',
  defaultUserId: process.env.DEFAULT_USER_ID || '',
  defaultUserName: process.env.DEFAULT_USER_NAME || '',
};

export function validateConfig() {
  const errors = [];
  if (!config.serviceAccountPath || !existsSync(config.serviceAccountPath)) {
    errors.push('GOOGLE_APPLICATION_CREDENTIALS no configurada o archivo no encontrado. Ejecuta: npm run setup');
  }
  if (!config.databaseURL) {
    errors.push('FIREBASE_DATABASE_URL no configurada. Ejecuta: npm run setup');
  }
  return errors;
}
