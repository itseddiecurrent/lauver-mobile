import { describe, expect, it, vi } from 'vitest';

import { ResendPasswordResetDelivery } from '../src/password-reset-delivery.js';

describe('ResendPasswordResetDelivery', () => {
  it('sends a one-time token with authenticated, idempotent provider headers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email-id' }), { status: 200 }),
    );
    const delivery = new ResendPasswordResetDelivery(
      'provider-api-key',
      'noreply@lauver.ai',
      fetchMock,
    );

    await delivery.sendPasswordReset('runner@example.com', 'one-time-reset-token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toMatchObject({
      Authorization: 'Bearer provider-api-key',
      'Content-Type': 'application/json',
      'User-Agent': 'lauver-api/0.1.0',
    });
    expect((options?.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^lauver-password-reset-[0-9a-f]{64}$/,
    );
    const body = options?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON string body');
    expect(JSON.parse(body)).toMatchObject({
      from: 'noreply@lauver.ai',
      to: ['runner@example.com'],
      subject: 'Reset your Lauver password',
    });
    expect(body).toContain('one-time-reset-token');
    expect(body).not.toContain('provider-api-key');
  });

  it('fails closed when the provider rejects delivery', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429 }));
    const delivery = new ResendPasswordResetDelivery(
      'provider-api-key',
      'noreply@lauver.ai',
      fetchMock,
    );

    await expect(
      delivery.sendPasswordReset('runner@example.com', 'one-time-reset-token'),
    ).rejects.toThrow('status 429');
  });
});
