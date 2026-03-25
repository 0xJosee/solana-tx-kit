# Migration Guide: 0.1.x to 0.2.0

Version 0.2.0 is a security-hardening release. Most changes are transparent, but there are 4 breaking changes that may require code updates.

## Breaking Change 1: Jito HTTPS Required

**Before:** `http://` URLs were accepted for the Jito block engine.

**After:** `http://` throws `INVALID_ARGUMENT`. Only `https://` is accepted by default.

**Who is affected:** Users connecting to local Jito validators or test environments via HTTP.

**Fix:**

```typescript
// Before
.withJito({
  blockEngineUrl: "http://localhost:8899",
  tipPayer: keypair,
})

// After
.withJito({
  blockEngineUrl: "http://localhost:8899",
  tipPayer: keypair,
  allowInsecureHttp: true, // <-- add this
})
```

## Breaking Change 2: Tip Cap (0.1 SOL Default)

**Before:** `createTipInstruction` accepted any tip amount with no upper bound.

**After:** Tips are clamped to `JITO_MAX_TIP_LAMPORTS` (100,000,000 lamports = 0.1 SOL) by default.

**Who is affected:** Users sending tips larger than 0.1 SOL (uncommon but possible for high-priority MEV).

**Fix:**

```typescript
// Option A: Set maxTipLamports in JitoConfig
.withJito({
  blockEngineUrl: "https://mainnet.block-engine.jito.wtf",
  tipPayer: keypair,
  maxTipLamports: 500_000_000, // 0.5 SOL
})

// Option B: Pass bounds directly to createTipInstruction (standalone usage)
createTipInstruction(payer, 200_000_000, {
  maxTipLamports: 500_000_000,
});
```

## Breaking Change 3: Health Report Keys Changed

**Before:** `getHealthReport()` used raw endpoint URLs (including query params) as map keys when no `label` was set.

**After:** URLs are sanitized — query parameters are stripped and long path segments are masked.

**Who is affected:** Users who look up health metrics by raw URL string.

**Fix:**

```typescript
// Before
const metrics = report.get("https://mainnet.helius-rpc.com/?api-key=SECRET");

// After — best fix: always set a label
.rpcPool([
  { url: "https://mainnet.helius-rpc.com/?api-key=SECRET", label: "helius" },
])
const metrics = report.get("helius");
```

## Breaking Change 4: Processed != Confirmed

**Before:** When `commitment: "confirmed"` was requested, transactions at `processed` level were also accepted as confirmed.

**After:** `processed` is only accepted when `commitment: "processed"` is explicitly set.

**Who is affected:** Users relying on faster "early" confirmations. Confirmation may now take slightly longer to resolve because it waits for actual `confirmed` status.

**Fix:**

```typescript
// If you want the fastest possible confirmation (at the cost of finality):
await sender.send(tx, {
  commitment: "processed",
});
```

## Stricter Validation (Non-Breaking for Valid Configs)

All configuration objects now validate their inputs at construction time. If your existing config was valid, nothing changes. If it contained issues like:

- `maxRetries: Infinity` or `maxRetries: -1`
- `baseDelayMs: 0`
- `minMicroLamports > maxMicroLamports`
- `weight: 0` on an RPC endpoint
- Empty `endpoints` array
- `NaN` in any numeric config field

...you will now get a clear `INVALID_ARGUMENT` error at construction time instead of undefined behavior at runtime.

## New Optional Fields

These new fields are backward-compatible (all optional):

| Interface | New Field | Description |
|-----------|-----------|-------------|
| `JitoConfig` | `allowInsecureHttp?: boolean` | Allow `http://` for block engine URL |
| `RetryConfig` | `totalTimeoutMs?: number` | Max wall-clock time for all retry attempts |
| `createTipInstruction` | `bounds?` (3rd arg) | Override min/max tip lamports |

## Behavioral Changes (Non-Breaking)

These changes improve safety and correctness without changing the API:

- **Transaction immutability:** `send()` and `sendJitoBundle()` now clone transactions. Your originals are never mutated.
- **Jito bundle retry:** Blockhash is refreshed on each retry attempt (previously reused a single blockhash).
- **onRetry resilience:** The `onRetry` hook is wrapped in try-catch with a 10s timeout.
- **Health check timeouts:** Each health check has a 5-second timeout.
- **Polling interval floor:** Confirmation `pollIntervalMs` is clamped to a minimum of 500ms.
- **Static fee cap:** `{ microLamports: N }` overrides are capped at `maxMicroLamports` (default 1,000,000).
