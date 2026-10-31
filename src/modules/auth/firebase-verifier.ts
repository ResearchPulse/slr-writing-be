import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { TokenVerifier } from '../../middleware/auth.middleware.js';

/** The part of a decoded Firebase ID token this service relies on. */
export interface DecodedIdToken {
  uid: string;
  aud?: string;
  email?: string;
}

export type VerifyIdToken = (token: string, checkRevoked: boolean) => Promise<DecodedIdToken>;

export interface FirebaseVerifierOptions {
  /** The Firebase project shared with slr-be. Tokens issued for any other project are rejected. */
  projectId: string;
  checkRevoked?: boolean;
  /** Longest wait for the library (it may be fetching Google's public keys). A slow answer counts as invalid. Default 10 s. */
  timeoutMs?: number;
  /** Replaceable in tests. The default asks firebase-admin, which checks signature, issuer, audience and expiry. */
  verify?: VerifyIdToken;
}

const APP_NAME = 'slr-writing-be';

// verifyIdToken only needs the project id to check signatures against Google's public keys; no secret is involved.
const appFor = (projectId: string): App =>
  getApps().find((app) => app.name === APP_NAME) ?? initializeApp({ projectId }, APP_NAME);

/**
 * Builds the verifier registered with `setTokenVerifier`. It returns the user for a valid token and null otherwise,
 * so the auth middleware answers 401. It never throws and never lets the reason for a rejection reach the client.
 */
export function createFirebaseVerifier(options: FirebaseVerifierOptions): TokenVerifier {
  const projectId = options.projectId.trim();
  if (!projectId) throw new Error('A Firebase project id is required to verify tokens');
  const checkRevoked = options.checkRevoked ?? false;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const verify: VerifyIdToken = options.verify ?? ((token, revoked) => getAuth(appFor(projectId)).verifyIdToken(token, revoked));

  return async (token) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const decoded = await Promise.race([
        verify(token, checkRevoked),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('token verification timed out')), timeoutMs); }),
      ]);
      // The library already checks the audience; check again, and insist it is present, so a faulty or replaced
      // verifier cannot widen access.
      if (!decoded || typeof decoded.uid !== 'string' || decoded.uid.length === 0) return null;
      if (decoded.aud !== projectId) return null;
      return { uid: decoded.uid, ...(typeof decoded.email === 'string' && decoded.email.length > 0 ? { email: decoded.email } : {}) };
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
