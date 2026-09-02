import { hashToken, type PasswordResetDelivery } from './auth.js';

type Fetching = typeof fetch;

export class ResendPasswordResetDelivery implements PasswordResetDelivery {
  readonly #apiKey: string;
  readonly #fromEmail: string;
  readonly #fetch: Fetching;

  constructor(apiKey: string, fromEmail: string, fetchImplementation: Fetching = fetch) {
    this.#apiKey = apiKey;
    this.#fromEmail = fromEmail;
    this.#fetch = fetchImplementation;
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const response = await this.#fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `lauver-password-reset-${hashToken(token)}`,
        'User-Agent': 'lauver-api/0.1.0',
      },
      body: JSON.stringify({
        from: this.#fromEmail,
        to: [email],
        subject: 'Reset your Lauver password',
        text: [
          'Use this one-time token in the Lauver app to reset your password:',
          '',
          token,
          '',
          'This token expires soon. If you did not request a password reset, you can ignore this email.',
        ].join('\n'),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Password-reset delivery failed with status ${response.status}`);
    }
  }
}
