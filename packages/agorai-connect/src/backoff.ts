/**
 * Exponential backoff with jitter.
 *
 * Usage:
 *   const backoff = new Backoff();
 *   await backoff.wait();   // 1s + jitter
 *   await backoff.wait();   // 2s + jitter
 *   backoff.succeed();      // reset to base
 */

export class Backoff {
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly factor: number;
  private readonly jitter: number;
  private failures = 0;

  constructor(opts?: { baseMs?: number; maxMs?: number; factor?: number; jitter?: number }) {
    this.baseMs = opts?.baseMs ?? 1000;
    this.maxMs = opts?.maxMs ?? 60_000;
    this.factor = opts?.factor ?? 2;
    this.jitter = opts?.jitter ?? 0.25;
  }

  /** Number of consecutive failures tracked. */
  get consecutiveFailures(): number {
    return this.failures;
  }

  /** Compute the delay for the current failure count (without waiting). */
  delay(): number {
    const raw = Math.min(this.baseMs * Math.pow(this.factor, this.failures), this.maxMs);
    const jitterRange = raw * this.jitter;
    return raw + (Math.random() * 2 - 1) * jitterRange;
  }

  /** Increment failure count and sleep for the computed delay. */
  async wait(): Promise<void> {
    const ms = this.delay();
    this.failures++;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Reset failure count on success. */
  succeed(): void {
    this.failures = 0;
  }
}
