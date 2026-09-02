export class RateLimitExceededError extends Error {
  constructor() {
    super('Rate limit exceeded');
    this.name = 'RateLimitExceededError';
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
      throw new RateLimitExceededError();
    }
    existing.count += 1;
  }
}
