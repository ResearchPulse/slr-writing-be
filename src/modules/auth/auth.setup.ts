import { env } from '../../config/env.js';
import { setTokenVerifier } from '../../middleware/auth.middleware.js';
import { createFirebaseVerifier } from './firebase-verifier.js';

/**
 * Registers the Firebase verifier when a project is configured. Called once at start-up (not by createApp),
 * so tests keep full control of the verifier. In production a missing project id already stopped the process in parseEnv.
 */
export function configureAuth(): void {
  if (!env.FIREBASE_PROJECT_ID) return;
  setTokenVerifier(createFirebaseVerifier({ projectId: env.FIREBASE_PROJECT_ID, checkRevoked: env.FIREBASE_CHECK_REVOKED }));
}
