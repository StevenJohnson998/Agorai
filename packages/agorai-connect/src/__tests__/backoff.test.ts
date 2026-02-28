import { describe, it, expect } from "vitest";
import { Backoff } from "../backoff.js";

describe("Backoff", () => {
  it("computes exponential delays", () => {
    const b = new Backoff({ baseMs: 1000, maxMs: 60_000, factor: 2, jitter: 0 });

    // failures=0 → 1000 * 2^0 = 1000
    expect(b.delay()).toBe(1000);
    b["failures"] = 1; // 1000 * 2^1 = 2000
    expect(b.delay()).toBe(2000);
    b["failures"] = 2; // 1000 * 2^2 = 4000
    expect(b.delay()).toBe(4000);
    b["failures"] = 3; // 1000 * 2^3 = 8000
    expect(b.delay()).toBe(8000);
  });

  it("caps at maxMs", () => {
    const b = new Backoff({ baseMs: 1000, maxMs: 5000, factor: 2, jitter: 0 });

    b["failures"] = 10; // 1000 * 2^10 = 1024000 → capped at 5000
    expect(b.delay()).toBe(5000);
  });

  it("applies jitter within expected range", () => {
    const b = new Backoff({ baseMs: 1000, maxMs: 60_000, factor: 2, jitter: 0.25 });

    // failures=0 → raw=1000, jitter range = ±250, so delay ∈ [750, 1250]
    const delays = Array.from({ length: 100 }, () => b.delay());
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(750);
      expect(d).toBeLessThanOrEqual(1250);
    }

    // Verify there's actually variance (not all identical)
    const unique = new Set(delays.map((d) => Math.round(d)));
    expect(unique.size).toBeGreaterThan(1);
  });

  it("resets on succeed()", () => {
    const b = new Backoff({ baseMs: 1000, maxMs: 60_000, factor: 2, jitter: 0 });

    b["failures"] = 5;
    expect(b.consecutiveFailures).toBe(5);

    b.succeed();
    expect(b.consecutiveFailures).toBe(0);
    expect(b.delay()).toBe(1000); // back to base
  });

  it("wait() increments failure count", async () => {
    const b = new Backoff({ baseMs: 10, maxMs: 100, factor: 2, jitter: 0 }); // fast for testing

    expect(b.consecutiveFailures).toBe(0);
    await b.wait();
    expect(b.consecutiveFailures).toBe(1);
    await b.wait();
    expect(b.consecutiveFailures).toBe(2);
  });
});
