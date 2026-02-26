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
});
