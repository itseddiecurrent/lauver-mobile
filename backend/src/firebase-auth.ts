import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export type FirebaseVerifiedIdentity = {
  uid: string;
  email: string | undefined;
  emailVerified: boolean;
  displayName: string | null;
  signInProvider: string | undefined;
};

export interface FirebaseTokenVerifier {
  verifyIdToken(idToken: string): Promise<FirebaseVerifiedIdentity>;
  deleteUser(uid: string): Promise<void>;
}

export class FirebaseAdminTokenVerifier implements FirebaseTokenVerifier {
  readonly #auth;

  constructor(options: { projectId: string; clientEmail: string; privateKey: string }) {
    const app = getApps()[0] ?? initializeApp({
      credential: cert({
        projectId: options.projectId,
        clientEmail: options.clientEmail,
        privateKey: options.privateKey.replace(/\\n/g, '\n'),
      }),
      projectId: options.projectId,
    });
    this.#auth = getAuth(app);
  }

  async verifyIdToken(idToken: string): Promise<FirebaseVerifiedIdentity> {
    const decoded = await this.#auth.verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified === true,
      displayName: typeof decoded.name === 'string' ? decoded.name : null,
      signInProvider: decoded.firebase?.sign_in_provider,
    };
  }

  async deleteUser(uid: string): Promise<void> {
    await this.#auth.deleteUser(uid);
  }
}
