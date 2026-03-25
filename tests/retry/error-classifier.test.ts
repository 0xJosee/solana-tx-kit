import { describe, expect, it } from "vitest";
import { SolTxError, SolTxErrorCode } from "../../src/errors.js";
import { classifyError, isBlockhashExpired, isRateLimited } from "../../src/retry/error-classifier.js";

describe("classifyError", () => {
  it("classifies rate limit (429) as retryable", () => {
    const result = classifyError(new Error("HTTP 429 Too many requests"));
    expect(result.retryable).toBe(true);
    expect(result.needsResign).toBe(false);
  });

  it("classifies service unavailable (503) as retryable", () => {
    const result = classifyError(new Error("503 Service unavailable"));
    expect(result.retryable).toBe(true);
  });

  it("classifies TransactionExpiredBlockheightExceeded as retryable + needsResign", () => {
    const result = classifyError(new Error("TransactionExpiredBlockheightExceeded"));
    expect(result.retryable).toBe(true);
    expect(result.needsResign).toBe(true);
  });

  it("classifies blockhash not found as retryable + needsResign", () => {
    const result = classifyError(new Error("blockhash not found"));
    expect(result.retryable).toBe(true);
    expect(result.needsResign).toBe(true);
  });

  it("classifies network errors (ECONNRESET) as retryable", () => {
    const err = new Error("Connection reset");
    (err as NodeJS.ErrnoException).code = "ECONNRESET";
    const result = classifyError(err);
    expect(result.retryable).toBe(true);
    expect(result.needsResign).toBe(false);
  });

  it("classifies ETIMEDOUT as retryable", () => {
    const err = new Error("Timed out");
    (err as NodeJS.ErrnoException).code = "ETIMEDOUT";
    const result = classifyError(err);
    expect(result.retryable).toBe(true);
  });

  it("classifies insufficient funds as non-retryable", () => {
    const result = classifyError(new Error("insufficient funds for transaction"));
    expect(result.retryable).toBe(false);
  });

  it("classifies signature verification failed as non-retryable", () => {
    const result = classifyError(new Error("Signature verification failed"));
    expect(result.retryable).toBe(false);
  });

  it("classifies 'Node is behind' as retryable without needsResign", () => {
    const result = classifyError(new Error("Node is behind by 50 slots"));
    expect(result.retryable).toBe(true);
    expect(result.needsResign).toBe(false);
    expect(result.errorType).toBe("Node is behind");
  });

  it("classifies 'node is unhealthy' as retryable without needsResign", () => {
    const result = classifyError(new Error("node is unhealthy"));
    expect(result.retryable).toBe(true);
    expect(result.needsResign).toBe(false);
  });

  it("classifies http status 429 property as rate limited", () => {
    const err = new Error("Request failed") as Error & { status: number };
    err.status = 429;
    const result = classifyError(err);
    expect(result.retryable).toBe(true);
    expect(result.errorType).toBe(SolTxErrorCode.RATE_LIMITED);
  });

  it("classifies http statusCode 503 property as service unavailable", () => {
    const err = new Error("Request failed") as Error & { statusCode: number };
    err.statusCode = 503;
    const result = classifyError(err);
    expect(result.retryable).toBe(true);
    expect(result.errorType).toBe(SolTxErrorCode.SERVICE_UNAVAILABLE);
  });

  it("classifies insufficient funds with INSUFFICIENT_FUNDS error type", () => {
    const result = classifyError(new Error("insufficient funds for transfer"));
    expect(result.retryable).toBe(false);
    expect(result.errorType).toBe(SolTxErrorCode.INSUFFICIENT_FUNDS);
  });

  it("classifies unknown errors as non-retryable", () => {
    const result = classifyError(new Error("Something random happened"));
    expect(result.retryable).toBe(false);
    expect(result.errorType).toBe("UNKNOWN");
  });

  it("classifies SolTxError(BLOCKHASH_EXPIRED) as retryable + needsResign", () => {
    const err = new SolTxError(SolTxErrorCode.BLOCKHASH_EXPIRED, "Blockhash expired during confirmation");
    const result = classifyError(err);
    expect(result.retryable).toBe(true);
    expect(result.needsResign).toBe(true);
    expect(result.errorType).toBe("BLOCKHASH_EXPIRED");
  });
});

describe("isBlockhashExpired", () => {
  it("returns true for blockhash not found", () => {
    expect(isBlockhashExpired(new Error("blockhash not found"))).toBe(true);
  });

  it("returns true for TransactionExpiredBlockheightExceeded", () => {
    expect(isBlockhashExpired(new Error("TransactionExpiredBlockheightExceeded"))).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isBlockhashExpired(new Error("insufficient funds"))).toBe(false);
  });

  it("returns true for SolTxError with BLOCKHASH_EXPIRED code", () => {
    const err = new SolTxError(SolTxErrorCode.BLOCKHASH_EXPIRED, "Blockhash expired during confirmation");
    expect(isBlockhashExpired(err)).toBe(true);
  });
});

describe("isRateLimited", () => {
  it("returns true for 429 errors", () => {
    expect(isRateLimited(new Error("HTTP 429"))).toBe(true);
  });

  it("returns true for Too many requests", () => {
    expect(isRateLimited(new Error("Too many requests"))).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isRateLimited(new Error("some error"))).toBe(false);
  });

  it("returns true for error with status 429 property", () => {
    const err = new Error("Failed") as Error & { status: number };
    err.status = 429;
    expect(isRateLimited(err)).toBe(true);
  });

  it("returns true for status 429 message", () => {
    expect(isRateLimited(new Error("status 429"))).toBe(true);
  });
});
