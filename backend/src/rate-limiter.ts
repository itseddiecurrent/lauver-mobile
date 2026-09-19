export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 1) {
    super('Rate limit exceeded');
    this.name = 'RateLimitExceededError';
    this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
  }
}

type Bucket = { count: number; resetAt: number };

export class InMemoryRateLimiter {
  readonly #windowMilliseconds: number;
  readonly #maxAttempts: number;
  readonly #buckets = new Map<string, Bucket>();
  readonly #now: () => number;

  constructor(windowMilliseconds: number, maxAttempts: number, now: () => number = Date.now) {
    this.#windowMilliseconds = windowMilliseconds;
    this.#maxAttempts = maxAttempts;
    this.#now = now;
  }

  consume(key: string): void {
    const now = this.#now();
    const existing = this.#buckets.get(key);
    if (existing === undefined || existing.resetAt <= now) {
      this.#buckets.set(key, { count: 1, resetAt: now + this.#windowMilliseconds });
      return;
    }
    if (existing.count >= this.#maxAttempts) {
      throw new RateLimitExceededError(Math.ceil((existing.resetAt - now) / 1_000));
    }
    existing.count += 1;
  }
}
