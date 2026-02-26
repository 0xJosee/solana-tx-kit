# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**solana-tx-kit** — Production-grade Solana transaction infrastructure library. Provides retry logic, dynamic priority fees, RPC connection pooling with failover, Jito bundle support, blockhash management, and typed lifecycle events. Peer dependency on `@solana/web3.js ^1.87.0`.

## Commands

```bash
pnpm install              # Install dependencies
pnpm run build            # Build ESM + CJS via tsup → dist/
pnpm run dev              # Build in watch mode
pnpm run test             # Run all tests (vitest)
pnpm run test:watch       # Run tests in watch mode
pnpm run test:coverage    # Run tests with v8 coverage (90% threshold)
pnpm run lint             # Lint + format check (biome)
pnpm run lint:fix         # Auto-fix lint + format issues
pnpm run typecheck        # TypeScript strict type checking
```

Run a single test file:
```bash
pnpm vitest run tests/retry/retry.test.ts
```

Run tests matching a pattern:
```bash
pnpm vitest run -t "should retry on retryable error"
```

CI runs: lint → typecheck → test → build (across Node 18, 20, 22).

## Architecture

### Module Structure

Each module lives in its own `src/<module>/` directory with `types.ts`, implementation file(s), and barrel `index.ts`:

- **`sender/`** — `TransactionSender` (main orchestrator) and `TransactionSenderBuilder` (fluent builder API). Composes all other modules into a unified send pipeline.
- **`rpc/`** — `ConnectionPool` with weighted-round-robin or latency-based endpoint selection, per-endpoint `CircuitBreaker` (CLOSED→OPEN→HALF_OPEN), and `HealthTracker` with EMA latency metrics.
- **`retry/`** — `withRetry()` generic retry function with full-jitter exponential backoff. `classifyError()` determines if errors are retryable, non-retryable, or blockhash-expired.
- **`priority-fee/`** — `estimatePriorityFee()` for percentile-based on-chain fee analysis. `createComputeBudgetInstructions()` for injecting compute budget IXs.
- **`blockhash/`** — `BlockhashManager` with TTL cache, background refresh interval, and promise coalescing to deduplicate concurrent fetches.
- **`confirmation/`** — `TransactionConfirmer` with dual-strategy: WebSocket subscription (primary) + polling fallback. First-signal-wins race.
- **`jito/`** — `JitoBundleSender` for 1-5 transaction atomic bundles. Tip account rotation via `getNextTipAccount()` and `createTipInstruction()`.
- **`simulation/`** — `simulateTransaction()` for pre-flight validation and compute unit measurement.

### Shared Infrastructure

- **`errors.ts`** — `SolTxError` (base with typed `code` field) and `RetryableError` subclass. Error codes in `SolTxErrorCode` enum.
- **`events.ts`** — `TypedEventEmitter` extending Node's EventEmitter with generics. `TxEvent` enum for lifecycle events.
- **`constants.ts`** — All configuration defaults (retry delays, fee bounds, timeouts, Jito tip accounts).
- **`types.ts`** — Core shared types (`SolanaTransaction` union of `Transaction | VersionedTransaction`).

### Key Patterns

- **Builder pattern**: `TransactionSender.builder().rpc(...).signer(...).with*(...).build()` — all `.with*()` methods optional with sensible defaults.
- **Composition over inheritance**: `TransactionSender` composes modules; each module is independently usable and testable.
- **Promise coalescing**: `BlockhashManager` deduplicates concurrent blockhash fetches.
- **Retry-aware blockhash refresh**: On `BLOCKHASH_EXPIRED`, the sender force-refreshes and retries with a new blockhash.
- **Resource cleanup**: Classes with background tasks (`BlockhashManager`, `HealthTracker`) expose `.destroy()` to clear intervals/listeners.

### Send Pipeline Flow

```
send(tx) → estimate priority fee → inject compute budget IXs
  → [retry loop]: get blockhash → sign → simulate (optional) → send via RPC
  → confirm (WS + polling) → return SendResult
  → on blockhash expiry: refresh + retry
  → on retryable error: backoff + retry
  → on non-retryable / exhausted: throw SolTxError
```

### Test Structure

Tests mirror `src/` structure under `tests/`. Shared fixtures and mock connections in `tests/helpers/`. Vitest globals are enabled (no need to import `describe`/`it`/`expect`). Coverage excludes barrel `index.ts` and `types.ts` files.

## Code Style

- **Biome** for linting and formatting (not ESLint/Prettier)
- 2-space indent, double quotes, trailing commas, semicolons
- Line width: 120
- `noExplicitAny: error` — no `any` types allowed
- `noUnusedVariables` and `noUnusedImports` are errors
- TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`

## Workflow Orchestration

### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update tasks/lessons.md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. Plan First: Write plan to tasks/todo.md with checkable items
2. Verify Plan: Check in before starting implementation
3. Track Progress: Mark items complete as you go
4. Explain Changes: High-level summary at each step
5. Document Results: Add review section to tasks/todo.md
6. Capture Lessons: Update tasks/lessons.md after corrections

## Core Principles

- Simplicity First: Make every change as simple as possible. Impact minimal code.
- No Laziness: Find root causes. No temporary fixes. Senior developer standards.
- Minimal Impact: Changes should only touch what's necessary. Avoid introducing bugs.
