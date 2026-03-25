import { describe, expect, it, vi } from "vitest";
import { SolTxError, SolTxErrorCode } from "../../src/errors.js";
import { withRetry } from "../../src/retry/retry.js";

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("429 Too many requests")).mockResolvedValueOnce("ok");

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10, backoffMultiplier: 2 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws NON_RETRYABLE for non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("insufficient funds"));

    await expect(
      withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10, backoffMultiplier: 2 }),
    ).rejects.toThrow(SolTxError);

    try {
      await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10, backoffMultiplier: 2 });
    } catch (err) {
      expect((err as SolTxError).code).toBe(SolTxErrorCode.NON_RETRYABLE);
    }
  });

  it("throws RETRIES_EXHAUSTED after max retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503 Service unavailable"));

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10, backoffMultiplier: 2 }),
    ).rejects.toThrow(SolTxError);

    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("calls onRetry hook", async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(new Error("503 Service unavailable")).mockResolvedValueOnce("ok");

    await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
      backoffMultiplier: 2,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 0, expect.any(Number));
  });

  it("respects custom retry predicate", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("custom error"));
    const retryPredicate = vi.fn().mockReturnValue(false);

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 1,
        maxDelayMs: 10,
        backoffMultiplier: 2,
        retryPredicate,
      }),
    ).rejects.toThrow();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(retryPredicate).toHaveBeenCalledWith(expect.any(Error), 0);
  });

  it("passes retry context to fn", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10, backoffMultiplier: 2 });

    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 0,
        totalAttempts: 4,
        elapsed: expect.any(Number),
      }),
    );
  });

  describe("config validation", () => {
    it("throws INVALID_ARGUMENT when maxRetries > 50", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      await expect(
        withRetry(fn, { maxRetries: 51, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 }),
      ).rejects.toThrow(SolTxError);

      try {
        await withRetry(fn, { maxRetries: 51, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 });
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((err as SolTxError).message).toContain("maxRetries");
      }
      expect(fn).not.toHaveBeenCalled();
    });

    it("throws INVALID_ARGUMENT when maxRetries is NaN", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      await expect(
        withRetry(fn, { maxRetries: Number.NaN, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 }),
      ).rejects.toThrow(SolTxError);

      try {
        await withRetry(fn, { maxRetries: Number.NaN, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 });
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((err as SolTxError).message).toContain("maxRetries");
      }
      expect(fn).not.toHaveBeenCalled();
    });

    it("throws INVALID_ARGUMENT when baseDelayMs is 0", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 100, backoffMultiplier: 2 }),
      ).rejects.toThrow(SolTxError);

      try {
        await withRetry(fn, { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 100, backoffMultiplier: 2 });
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((err as SolTxError).message).toContain("baseDelayMs");
      }
      expect(fn).not.toHaveBeenCalled();
    });

    it("throws INVALID_ARGUMENT when backoffMultiplier is 0", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 0 }),
      ).rejects.toThrow(SolTxError);

      try {
        await withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 0 });
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((err as SolTxError).message).toContain("backoffMultiplier");
      }
      expect(fn).not.toHaveBeenCalled();
    });

    it("throws INVALID_ARGUMENT when maxDelayMs < baseDelayMs", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10, backoffMultiplier: 2 }),
      ).rejects.toThrow(SolTxError);

      try {
        await withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10, backoffMultiplier: 2 });
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((err as SolTxError).message).toContain("maxDelayMs");
        expect((err as SolTxError).message).toContain("baseDelayMs");
      }
      expect(fn).not.toHaveBeenCalled();
    });

    it("accepts maxRetries = 0 (try once, no retries)", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      const result = await withRetry(fn, { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("accepts maxRetries = 0 and throws on failure without retrying", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("503 Service unavailable"));
      await expect(
        withRetry(fn, { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 }),
      ).rejects.toThrow(SolTxError);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("throws INVALID_ARGUMENT when totalTimeoutMs is 0 or negative", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2, totalTimeoutMs: 0 }),
      ).rejects.toThrow(SolTxError);

      try {
        await withRetry(fn, {
          maxRetries: 3,
          baseDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
          totalTimeoutMs: 0,
        });
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((err as SolTxError).message).toContain("totalTimeoutMs");
      }
      expect(fn).not.toHaveBeenCalled();
    });

    it("throws INVALID_ARGUMENT when totalTimeoutMs is negative", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2, totalTimeoutMs: -1 }),
      ).rejects.toThrow(SolTxError);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("totalTimeoutMs", () => {
    it("stops retrying when totalTimeoutMs is exceeded", async () => {
      vi.useRealTimers();
      const fn = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new Error("503 Service unavailable");
      });

      const start = Date.now();
      await expect(
        withRetry(fn, {
          maxRetries: 100,
          baseDelayMs: 1,
          maxDelayMs: 1,
          backoffMultiplier: 1,
          totalTimeoutMs: 200,
        }),
      ).rejects.toThrow(SolTxError);
      const elapsed = Date.now() - start;

      // Should have been cut short well before 100 retries
      expect(fn.mock.calls.length).toBeLessThan(100);
      // Should not have run much longer than the timeout
      expect(elapsed).toBeLessThan(2_000);
    });
  });

  describe("onRetry hook resilience", () => {
    it("onRetry hook errors do not break the retry loop", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("503 Service unavailable"))
        .mockRejectedValueOnce(new Error("503 Service unavailable"))
        .mockResolvedValueOnce("ok");

      const failingOnRetry = vi.fn().mockRejectedValue(new Error("hook crashed"));

      const result = await withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 1,
        maxDelayMs: 10,
        backoffMultiplier: 2,
        onRetry: failingOnRetry,
      });

      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(3);
      expect(failingOnRetry).toHaveBeenCalledTimes(2);
    });

    it("onRetry hook that throws synchronously does not break the retry loop", async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error("503 Service unavailable")).mockResolvedValueOnce("ok");

      const throwingOnRetry = vi.fn().mockImplementation(() => {
        throw new Error("sync hook crash");
      });

      const result = await withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 1,
        maxDelayMs: 10,
        backoffMultiplier: 2,
        onRetry: throwingOnRetry,
      });

      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
      expect(throwingOnRetry).toHaveBeenCalledTimes(1);
    });
  });
});
