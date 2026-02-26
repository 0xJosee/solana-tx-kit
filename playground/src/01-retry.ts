/**
 * Test 01 — withRetry: exponential backoff, error classification, hooks
 *
 * No RPC calls needed — pure logic test with real timings.
 */
import { withRetry, classifyError, isBlockhashExpired, isRateLimited, SolTxError } from "solana-tx-kit";
import { runTest, step, pass, fail, c, timer } from "./utils.js";

async function test() {
  // ── 1. Successful first-try call ──────────────────────────────
  step("First-try success");
  {
    let called = 0;
    const result = await withRetry(
      async () => {
        called++;
        return 42;
      },
      { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000, backoffMultiplier: 2 },
    );

    if (result !== 42) throw new Error(`Expected 42, got ${result}`);
    if (called !== 1) throw new Error(`Expected 1 call, got ${called}`);
    pass("Returns value on first success, called once");
  }

  // ── 2. Retry on retryable error ───────────────────────────────
  step("Retry on 429 (rate limit)");
  {
    let attempt = 0;
    const t = timer();
    const result = await withRetry(
      async () => {
        attempt++;
        if (attempt < 3) throw new Error("HTTP 429 Too Many Requests");
        return "ok";
      },
      { maxRetries: 5, baseDelayMs: 50, maxDelayMs: 500, backoffMultiplier: 2 },
    );

    const elapsed = t();
    if (result !== "ok") throw new Error(`Expected "ok", got ${result}`);
    if (attempt !== 3) throw new Error(`Expected 3 attempts, got ${attempt}`);
    pass(`Recovered after 2 retries in ${c.info(`${elapsed}ms`)}`);
  }

  // ── 3. Non-retryable error throws immediately ─────────────────
  step("Non-retryable error (insufficient funds)");
  {
    let attempt = 0;
    try {
      await withRetry(
        async () => {
          attempt++;
          throw new Error("insufficient funds for transaction");
        },
        { maxRetries: 5, baseDelayMs: 50, maxDelayMs: 500, backoffMultiplier: 2 },
      );
      throw new Error("Should have thrown");
    } catch (err) {
      if (!(err instanceof SolTxError)) throw new Error(`Expected SolTxError, got ${err}`);
      if (attempt !== 1) throw new Error(`Expected 1 attempt (no retry), got ${attempt}`);
      pass(`Threw SolTxError immediately, code=${c.info(err.code)}`);
    }
  }

  // ── 4. Retries exhausted ──────────────────────────────────────
  step("Retries exhausted after maxRetries");
  {
    let attempt = 0;
    const retries: number[] = [];
    try {
      await withRetry(
        async () => {
          attempt++;
          throw new Error("503 Service Unavailable");
        },
        {
          maxRetries: 3,
          baseDelayMs: 20,
          maxDelayMs: 200,
          backoffMultiplier: 2,
          onRetry: (_err, a, delay) => {
            retries.push(delay);
          },
        },
      );
      throw new Error("Should have thrown");
    } catch (err) {
      if (!(err instanceof SolTxError)) throw new Error(`Expected SolTxError, got ${err}`);
      if (attempt !== 4) throw new Error(`Expected 4 attempts (1 + 3 retries), got ${attempt}`);
      pass(`Exhausted after ${attempt} attempts, delays: [${retries.map((d) => `${Math.round(d)}ms`).join(", ")}]`);
    }
  }

  // ── 5. Error classifier ───────────────────────────────────────
  step("Error classifier — retryable errors");
  {
    const cases: Array<{ msg: string; retryable: boolean; needsResign: boolean }> = [
      { msg: "HTTP 429 Too many requests", retryable: true, needsResign: false },
      { msg: "503 Service unavailable", retryable: true, needsResign: false },
      { msg: "TransactionExpiredBlockheightExceeded", retryable: true, needsResign: true },
      { msg: "blockhash not found", retryable: true, needsResign: true },
      { msg: "insufficient funds", retryable: false, needsResign: false },
      { msg: "Signature verification failed", retryable: false, needsResign: false },
    ];

    for (const { msg, retryable, needsResign } of cases) {
      const result = classifyError(new Error(msg));
      if (result.retryable !== retryable) {
        throw new Error(`"${msg}": expected retryable=${retryable}, got ${result.retryable}`);
      }
      if (result.needsResign !== needsResign) {
        throw new Error(`"${msg}": expected needsResign=${needsResign}, got ${result.needsResign}`);
      }
    }
    pass(`All ${cases.length} error classifications correct`);
  }

  // ── 6. Helper predicates ──────────────────────────────────────
  step("Helper predicates: isBlockhashExpired, isRateLimited");
  {
    if (!isBlockhashExpired(new Error("blockhash not found"))) throw new Error("Expected true");
    if (!isBlockhashExpired(new Error("TransactionExpiredBlockheightExceeded"))) throw new Error("Expected true");
    if (isBlockhashExpired(new Error("insufficient funds"))) throw new Error("Expected false");

    if (!isRateLimited(new Error("HTTP 429"))) throw new Error("Expected true");
    if (!isRateLimited(new Error("Too many requests"))) throw new Error("Expected true");
    if (isRateLimited(new Error("some error"))) throw new Error("Expected false");

    pass("All predicates correct");
  }

  // ── 7. Custom retry predicate ─────────────────────────────────
  step("Custom retry predicate overrides default");
  {
    let attempt = 0;
    try {
      await withRetry(
        async () => {
          attempt++;
          throw new Error("HTTP 429 rate limited"); // normally retryable
        },
        {
          maxRetries: 5,
          baseDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
          retryPredicate: () => false, // force no retry
        },
      );
    } catch {
      // expected
    }
    if (attempt !== 1) throw new Error(`Expected 1 attempt (predicate says no), got ${attempt}`);
    pass("Custom predicate prevented retries");
  }
}

export const run = () => runTest("01 — withRetry + Error Classifier", test);

// Auto-run when executed directly
const isMain = process.argv[1]?.includes("01-retry");
if (isMain) run();
