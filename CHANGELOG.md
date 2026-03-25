# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-25

### Security

Full security audit with 65 findings addressed across all modules.

- **Tip safety:** `createTipInstruction` now enforces min/max bounds with a default cap of 0.1 SOL (`JITO_MAX_TIP_LAMPORTS`). Validates that lamports is a finite non-negative number.
- **Fee safety:** Static priority fee overrides (`{ microLamports: N }`) are now validated (non-negative, finite) and capped at `DEFAULT_PRIORITY_FEE_CONFIG.maxMicroLamports`. `estimatePriorityFee` validates that `minMicroLamports <= maxMicroLamports`.
- **HTTPS enforcement:** Jito block engine URL now rejects `http://` by default. Use `allowInsecureHttp: true` in `JitoConfig` for local testing.
- **Transaction immutability:** `send()` and `sendJitoBundle()` now clone all transactions before modification. Caller's original transaction objects are never mutated.
- **Jito bundle retry:** Blockhash is now refreshed inside the retry loop. Previously, a single stale blockhash was reused for all retry attempts.
- **URL sanitization:** RPC endpoint URLs are sanitized before logging — query parameters and long path segments (likely API keys) are masked. Always set `label` on endpoints for best results.
- **Destroyed guards:** `TransactionConfirmer` and `ConnectionPool` now check for destroyed state before operations, matching the existing guards on `BlockhashManager` and `TransactionSender`.
- **Confirmation spoofing fix:** `processed` commitment status is no longer reported as `confirmed`. It is only accepted when `commitment: "processed"` is explicitly requested.
- **Circuit breaker probe limit:** Only one probe request is allowed in HALF_OPEN state. Stuck probes auto-reset after `resetTimeoutMs`.

### Added

- `JitoConfig.allowInsecureHttp` option for local testing with HTTP block engine URLs.
- `RetryConfig.totalTimeoutMs` optional field — maximum wall-clock time for all retry attempts.
- `JITO_MAX_TIP_LAMPORTS` constant (100,000,000 lamports = 0.1 SOL) — default tip ceiling.
- `SolTxError.toJSON()` method for safe serialization (excludes `cause` and deep objects).
- `sanitizeUrl()` utility for masking sensitive URL components in logs.
- `createTipInstruction` now accepts an optional `bounds` parameter for min/max tip control.
- Comprehensive input validation on all config objects: `RetryConfig`, `FeeEstimateConfig`, `BlockhashManagerConfig`, `ConfirmationConfig`, `ConnectionPoolConfig`, `RpcEndpointConfig`.

### Changed

- **BREAKING:** Jito block engine URL must use `https://` (or set `allowInsecureHttp: true`).
- **BREAKING:** `getHealthReport()` keys are now sanitized URLs when no `label` is set (query params stripped, long path segments masked). Set `label` on endpoints for stable keys.
- **BREAKING:** `processed` status no longer satisfies `commitment: "confirmed"`. Use `commitment: "processed"` if you need early notification at processed level.
- **BREAKING:** Tips exceeding `JITO_MAX_TIP_LAMPORTS` (0.1 SOL) are silently clamped. Set `maxTipLamports` in `JitoConfig` to override.
- Static priority fees are capped at `maxMicroLamports` (default 1,000,000).
- `pollIntervalMs` is clamped to a minimum of 500ms; `timeoutMs` clamped to [1s, 300s].
- Health checks now have a 5-second timeout per endpoint.
- `Promise.allSettled` used for health check rounds (one hanging endpoint no longer blocks others).
- Builder's `build()` now shallow-clones the config, isolating the sender from post-build mutations.
- Error classifier uses structured HTTP status checks in addition to message patterns for 429/503 detection.
- `onRetry` hook is wrapped in try-catch with 10s timeout — a failing/hanging hook no longer blocks retries.
- `TypedEventEmitter` sets `maxListeners` to 50 to catch genuine leaks.
- Endpoint config is frozen (`Object.freeze`) in `HealthTracker` to prevent accidental mutation.

### Fixed

- `BlockhashManager` now force-refreshes when consecutive background refresh failures >= 2, preventing stale blockhash usage during RPC degradation.
- Dangling `setTimeout` timers in `Promise.race` patterns are now properly cleared on resolution.
- `FAILED` event `attempt` field now correctly reflects the actual attempt count from error context.
- `BlockhashManager.refreshBlockhash()` includes a 2-second negative cache after failures to prevent thundering herd on coalesced fetch errors.
- `BlockhashManager` validates RPC response: rejects empty blockhash strings and non-positive `lastValidBlockHeight`.
- Weighted round-robin index uses `% Number.MAX_SAFE_INTEGER` to prevent overflow instability.
- When all endpoints are unhealthy, fallback distributes across all endpoints (round-robin) instead of always using the first.
- `withFallback` limits iteration to 3 endpoints when all are unhealthy to prevent failure amplification.

### Validation errors (new in this version)

The following invalid configurations now throw `INVALID_ARGUMENT` immediately instead of causing undefined behavior at runtime:

| Config | Constraint |
|--------|-----------|
| `RetryConfig.maxRetries` | Finite integer, 0-50 |
| `RetryConfig.baseDelayMs` | Finite, > 0 |
| `RetryConfig.maxDelayMs` | Finite, >= baseDelayMs |
| `RetryConfig.backoffMultiplier` | Finite, > 0 |
| `RetryConfig.totalTimeoutMs` | Finite, > 0 (if set) |
| `FeeEstimateConfig.minMicroLamports` | Finite, >= 0 |
| `FeeEstimateConfig.maxMicroLamports` | Finite, >= 0, >= min |
| `BlockhashManagerConfig.ttlMs` | Finite, > 0 |
| `BlockhashManagerConfig.refreshIntervalMs` | >= 1000 |
| `BlockhashManagerConfig.fetchTimeoutMs` | >= 1000 (if set) |
| `ConnectionPoolConfig.endpoints` | Non-empty array |
| `ConnectionPoolConfig.healthCheckIntervalMs` | >= 1000 (if set) |
| `RpcEndpointConfig.weight` | > 0 (if set) |
| `createTipInstruction` lamports | Finite, >= 0 |

## [0.1.0] - 2026-02-26

### Added

- TransactionSender with builder pattern for composable transaction configuration
- Priority fee estimation via recent fee data sampling
- RPC connection pool with circuit breaker for fault-tolerant node management
- Jito MEV bundle support for bundle submission and tip management
- Transaction confirmation via WebSocket subscriptions with polling fallback
- Blockhash management with caching and automatic refresh
- Retry logic with exponential backoff and configurable attempts
- Typed event emitter for transaction lifecycle events
