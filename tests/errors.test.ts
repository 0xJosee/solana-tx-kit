import { describe, expect, it } from "vitest";
import { RetryableError, SolTxError, SolTxErrorCode } from "../src/errors.js";

describe("SolTxError", () => {
  it("constructor sets code, message, cause, and context", () => {
    const cause = new Error("underlying issue");
    const context = { txId: "abc123", attempt: 3 };
    const err = new SolTxError(SolTxErrorCode.TRANSACTION_FAILED, "tx failed", { cause, context });

    expect(err.code).toBe(SolTxErrorCode.TRANSACTION_FAILED);
    expect(err.message).toBe("tx failed");
    expect(err.cause).toBe(cause);
    expect(err.context).toEqual(context);
    expect(err.name).toBe("SolTxError");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SolTxError);
  });

  it("constructor works without optional options", () => {
    const err = new SolTxError(SolTxErrorCode.NON_RETRYABLE, "something broke");

    expect(err.code).toBe(SolTxErrorCode.NON_RETRYABLE);
    expect(err.message).toBe("something broke");
    expect(err.cause).toBeUndefined();
    expect(err.context).toBeUndefined();
  });

  it("toJSON() returns name, code, message, context without cause", () => {
    const cause = new Error("secret cause");
    const context = { endpoint: "https://rpc.example.com" };
    const err = new SolTxError(SolTxErrorCode.RATE_LIMITED, "rate limited", { cause, context });

    const json = err.toJSON();

    expect(json).toEqual({
      name: "SolTxError",
      code: SolTxErrorCode.RATE_LIMITED,
      message: "rate limited",
      context: { endpoint: "https://rpc.example.com" },
    });
    expect(json).not.toHaveProperty("cause");
  });

  it("toJSON() returns undefined context when none was provided", () => {
    const err = new SolTxError(SolTxErrorCode.BLOCKHASH_EXPIRED, "blockhash expired");
    const json = err.toJSON();

    expect(json.context).toBeUndefined();
    expect(json.name).toBe("SolTxError");
    expect(json.code).toBe(SolTxErrorCode.BLOCKHASH_EXPIRED);
  });
});

describe("RetryableError", () => {
  it("extends SolTxError", () => {
    const err = new RetryableError(SolTxErrorCode.RATE_LIMITED, "slow down");

    expect(err).toBeInstanceOf(SolTxError);
    expect(err).toBeInstanceOf(RetryableError);
    expect(err).toBeInstanceOf(Error);
  });

  it("sets retryAfterMs from options", () => {
    const err = new RetryableError(SolTxErrorCode.RATE_LIMITED, "slow down", {
      retryAfterMs: 2000,
    });

    expect(err.retryAfterMs).toBe(2000);
    expect(err.name).toBe("RetryableError");
    expect(err.code).toBe(SolTxErrorCode.RATE_LIMITED);
    expect(err.message).toBe("slow down");
  });

  it("retryAfterMs is undefined when not provided", () => {
    const err = new RetryableError(SolTxErrorCode.BLOCKHASH_EXPIRED, "expired");

    expect(err.retryAfterMs).toBeUndefined();
  });

  it("passes cause and context through to SolTxError", () => {
    const cause = new Error("root cause");
    const context = { attempt: 5 };
    const err = new RetryableError(SolTxErrorCode.RETRIES_EXHAUSTED, "gave up", {
      cause,
      context,
      retryAfterMs: 500,
    });

    expect(err.cause).toBe(cause);
    expect(err.context).toEqual(context);
    expect(err.retryAfterMs).toBe(500);
  });
});
