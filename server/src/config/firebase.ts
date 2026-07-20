import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import admin from 'firebase-admin';
import { env, isTest } from './env.js';
import { logger } from '../lib/logger.js';

/**
 * Resolve service-account credentials from an env var (hosted deploys) or a
 * file on disk (local development). The env var wins when both are present.
 */
function loadServiceAccount(): admin.ServiceAccount | null {
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as admin.ServiceAccount;
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON');
    }
  }

  if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      const raw = readFileSync(resolve(env.FIREBASE_SERVICE_ACCOUNT_PATH), 'utf8');
      return JSON.parse(raw) as admin.ServiceAccount;
    } catch (error) {
      throw new Error(
        `Could not read Firebase service account at ${env.FIREBASE_SERVICE_ACCOUNT_PATH}: ${
          (error as Error).message
        }`,
      );
    }
  }

  return null;
}

let initialized = false;

export function initFirebase(): void {
  if (initialized || admin.apps.length > 0) return;

  // Tests stub the auth middleware outright, so no real credentials are needed.
  if (isTest) {
    initialized = true;
    return;
  }

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    throw new Error(
      'Firebase credentials missing. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH.',
    );
  }

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  initialized = true;
  logger.info('Firebase Admin initialised');
}

export { admin };
