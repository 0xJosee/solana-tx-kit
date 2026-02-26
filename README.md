# solana-tx-kit

[![npm version](https://img.shields.io/npm/v/solana-tx-kit.svg)](https://www.npmjs.com/package/solana-tx-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

Production-grade Solana transaction infrastructure with retry logic, priority fees, RPC pooling, Jito bundles, and full lifecycle events.

## Features

- **Builder Pattern API** -- configure and compose exactly what you need
- **Exponential Backoff Retry** -- full-jitter backoff with error classification (retryable, non-retryable, blockhash-expired)
- **Dynamic Priority Fees** -- percentile-based estimation from recent fees, automatic compute budget instructions
- **RPC Connection Pool** -- multi-endpoint failover, weighted round-robin or latency-based selection, circuit breaker per endpoint, EMA health tracking
- **Blockhash Management** -- background refresh, TTL cache, promise coalescing
- **Transaction Simulation** -- pre-flight checks, compute unit extraction, error decoding
- **Transaction Confirmation** -- WebSocket + polling dual strategy, block height expiry detection
- **Jito Bundle Support** -- 1-5 transaction bundles, tip account rotation, status polling
- **Typed Lifecycle Events** -- SENDING, SENT, SIMULATED, CONFIRMED, RETRYING, BLOCKHASH_EXPIRED, FAILED, BUNDLE_*
- **Standalone Modules** -- every module is usable independently

## Installation

```bash
pnpm add solana-tx-kit @solana/web3.js
```

```bash
npm install solana-tx-kit @solana/web3.js
```

```bash
yarn add solana-tx-kit @solana/web3.js
```

> **Peer dependency:** `@solana/web3.js ^1.87.0`

## Quick Start

```typescript
import { TransactionSender } from "solana-tx-kit";
import { Keypair, Transaction, SystemProgram, PublicKey } from "@solana/web3.js";

const sender = TransactionSender.builder()
  .rpc("https://api.mainnet-beta.solana.com")
  .signer(keypair)
  .withPriorityFees({ targetPercentile: 75 })
  .withRetry({ maxRetries: 5 })
  .build();

const tx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: new PublicKey("..."),
    lamports: 1_000_000,
  })
);

const result = await sender.send(tx);
console.log("Signature:", result.signature);
```

## Builder API Reference

Chain methods on `TransactionSender.builder()` and call `.build()` to create a sender.

```typescript
const sender = TransactionSender.builder()
  .rpc("https://api.mainnet-beta.solana.com")    // single RPC endpoint
  // .rpcPool([...])                              // or multi-endpoint pool
  .signer(keypair)                                // transaction signer
  .withPriorityFees({ targetPercentile: 75 })     // dynamic fee estimation
  .withRetry({ maxRetries: 5 })                   // retry with backoff
  .withJito({ blockEngineUrl: "...", tipPayer: keypair }) // Jito bundles
  .withSimulation({ commitment: "confirmed" })    // pre-flight simulation
  .withConfirmation({ timeoutMs: 30000 })         // confirmation strategy
  .withBlockhash({ ttlMs: 60000 })                // blockhash cache config
  .withLogger(myLogger)                           // custom logger
  .commitment("confirmed")                        // default commitment
  .build();
```

| Method | Description | Required |
|---|---|---|
| `.rpc(url)` | Single RPC endpoint | Yes (or `.rpcPool`) |
| `.rpcPool(endpoints)` | Multi-endpoint connection pool with failover | Yes (or `.rpc`) |
| `.signer(keypair)` | Transaction signer | Yes |
| `.withPriorityFees(config)` | Enable dynamic priority fee estimation. Pass `false` to disable. | No |
| `.withRetry(config)` | Configure retry behavior with exponential backoff | No |
| `.withJito(config)` | Enable Jito bundle support | No |
| `.withSimulation(config)` | Configure pre-flight simulation. Pass `false` to disable. | No |
| `.withConfirmation(config)` | Configure confirmation strategy and timeout | No |
| `.withBlockhash(config)` | Configure blockhash caching and refresh | No |
| `.withLogger(logger)` | Provide a logger (`{ debug, info, warn, error }`) | No |
| `.commitment(level)` | Set default commitment level | No |

## Sending Transactions

### Basic Send

```typescript
const result = await sender.send(transaction);
// result: { signature: string }
```

### Send with Options

```typescript
const result = await sender.send(transaction, {
  commitment: "finalized",
  skipPreflight: true,
});
```

### Multiple Transactions

```typescript
const transactions = [tx1, tx2, tx3];
const results = await Promise.all(transactions.map((tx) => sender.send(tx)));
```

## Jito Bundles

Send up to 5 transactions as an atomic bundle through Jito's block engine.

```typescript
import { TransactionSender } from "solana-tx-kit";

const sender = TransactionSender.builder()
  .rpc("https://api.mainnet-beta.solana.com")
  .signer(keypair)
  .withJito({
    blockEngineUrl: "https://mainnet.block-engine.jito.wtf",
    tipPayer: keypair,
    tipLamports: 10_000,
  })
  .build();

const bundleResult = await sender.sendBundle([tx1, tx2, tx3]);
console.log("Bundle ID:", bundleResult.bundleId);
console.log("Status:", bundleResult.status); // BundleStatus.Landed
```

### Standalone Jito Usage

```typescript
import {
  JitoBundleSender,
  createTipInstruction,
  getNextTipAccount,
} from "solana-tx-kit";

const tipIx = createTipInstruction(payer.publicKey, 10_000);
transaction.add(tipIx);

const bundleSender = new JitoBundleSender({
  blockEngineUrl: "https://mainnet.block-engine.jito.wtf",
});
const result = await bundleSender.sendBundle([signedTx]);
```

## RPC Connection Pool

Distribute requests across multiple RPC endpoints with automatic failover.

```typescript
import { ConnectionPool } from "solana-tx-kit";

const pool = new ConnectionPool({
  endpoints: [
    { url: "https://rpc-1.example.com", weight: 3 },
    { url: "https://rpc-2.example.com", weight: 1 },
  ],
  strategy: "weighted-round-robin", // or "latency-based"
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeMs: 30_000,
  },
});

const connection = pool.getConnection();
```

Each endpoint has its own circuit breaker and health tracking with EMA latency metrics. Unhealthy endpoints are automatically removed from rotation and re-tested after the reset window.

## Event Listening

Subscribe to typed lifecycle events for observability, logging, or custom logic.

```typescript
sender.on(TxEvent.SENDING, ({ transaction }) => {
  console.log("Sending transaction...");
});

sender.on(TxEvent.SIMULATED, ({ unitsConsumed }) => {
  console.log(`Simulation used ${unitsConsumed} CUs`);
});

sender.on(TxEvent.CONFIRMED, ({ signature, slot }) => {
  console.log(`Confirmed in slot ${slot}: ${signature}`);
});

sender.on(TxEvent.RETRYING, ({ attempt, error }) => {
  console.warn(`Retry #${attempt}: ${error.message}`);
});

sender.on(TxEvent.BLOCKHASH_EXPIRED, ({ signature }) => {
  console.warn(`Blockhash expired for ${signature}, fetching new one...`);
});

sender.on(TxEvent.FAILED, ({ error }) => {
  console.error("Transaction failed:", error);
});
```

**All events:** `SENDING`, `SENT`, `SIMULATED`, `CONFIRMED`, `RETRYING`, `BLOCKHASH_EXPIRED`, `FAILED`, `BUNDLE_SENT`, `BUNDLE_CONFIRMED`, `BUNDLE_FAILED`

## Standalone Modules

Every module can be used independently without the builder.

```typescript
import {
  estimatePriorityFee,
  createComputeBudgetInstructions,
  simulateTransaction,
  withRetry,
  classifyError,
  BlockhashManager,
  TransactionConfirmer,
  ConnectionPool,
} from "solana-tx-kit";

// Estimate priority fees from recent transactions
const fee = await estimatePriorityFee(connection, transaction, {
  targetPercentile: 75,
});

// Create compute budget instructions
const ixs = createComputeBudgetInstructions({
  computeUnitLimit: 200_000,
  computeUnitPrice: fee.microLamports,
});

// Simulate a transaction
const sim = await simulateTransaction(connection, transaction, {
  commitment: "confirmed",
});

// Retry any async operation with backoff
const result = await withRetry(() => fetchData(), { maxRetries: 3 });

// Classify errors for retry decisions
const classification = classifyError(error);
// => { retryable: true, reason: "rate-limited" }

// Manage blockhashes with background refresh
const bhManager = new BlockhashManager(connection, { ttlMs: 60_000 });
const { blockhash, lastValidBlockHeight } = await bhManager.getBlockhash();

// Confirm transactions with WebSocket + polling
const confirmer = new TransactionConfirmer(connection);
const confirmation = await confirmer.confirm(signature, {
  timeoutMs: 30_000,
});
```

## Error Handling

All errors are thrown as `SolTxError` with a typed `code` field.

```typescript
import { SolTxError, SolTxErrorCode, RetryableError } from "solana-tx-kit";

try {
  await sender.send(tx);
} catch (err) {
  if (err instanceof SolTxError) {
    switch (err.code) {
      case SolTxErrorCode.BLOCKHASH_EXPIRED:
        // Transaction expired, rebuild and retry
        break;
      case SolTxErrorCode.INSUFFICIENT_FUNDS:
        // Not enough SOL
        break;
      case SolTxErrorCode.SIMULATION_FAILED:
        // Pre-flight simulation failed
        break;
      case SolTxErrorCode.CONFIRMATION_TIMEOUT:
        // Transaction may have landed but wasn't confirmed in time
        break;
      case SolTxErrorCode.ALL_ENDPOINTS_UNHEALTHY:
        // Every RPC endpoint is in circuit-breaker open state
        break;
      case SolTxErrorCode.RETRIES_EXHAUSTED:
        // All retry attempts failed
        break;
    }
  }
}
```

**Error codes:** `RETRIES_EXHAUSTED`, `NON_RETRYABLE`, `BLOCKHASH_EXPIRED`, `BLOCKHASH_FETCH_FAILED`, `SIMULATION_FAILED`, `INSUFFICIENT_FUNDS`, `CONFIRMATION_TIMEOUT`, `TRANSACTION_FAILED`, `ALL_ENDPOINTS_UNHEALTHY`, `RATE_LIMITED`, `BUNDLE_FAILED`, `BUNDLE_DROPPED`, `TIP_TOO_LOW`, `FEE_ESTIMATION_FAILED`

## Configuration Defaults

| Module | Setting | Default |
|---|---|---|
| **Retry** | Max retries | 3 |
| | Base delay | 500 ms |
| | Max delay | 10,000 ms |
| | Multiplier | 2x |
| **Priority Fee** | Target percentile | p75 |
| | Min fee | 1,000 microLamports |
| | Max fee | 1,000,000 microLamports |
| | Default compute units | 200,000 |
| **Confirmation** | Timeout | 60,000 ms |
| | Poll interval | 2,000 ms |
| | WebSocket | Enabled |
| | Commitment | `confirmed` |
| **Blockhash** | TTL | 60,000 ms |
| | Refresh interval | 30,000 ms |
| **Jito** | Block engine | mainnet |
| | Min tip | 1,000 lamports |

## Key Types

```typescript
import type {
  SenderConfig,
  SendResult,
  SendOptions,
  RetryConfig,
  RetryContext,
  FeeEstimateConfig,
  FeeEstimateResult,
  ComputeBudgetConfig,
  ConnectionPoolConfig,
  RpcEndpointConfig,
  HealthMetrics,
  CircuitBreakerConfig,
  JitoConfig,
  BundleResult,
  BundleStatus,
  SimulationConfig,
  SimulationResult,
  ConfirmationConfig,
  ConfirmationResult,
  BlockhashManagerConfig,
  BlockhashInfo,
  TxEventMap,
  Logger,
} from "solana-tx-kit";
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

```bash
pnpm install        # install dependencies
pnpm test           # run tests
pnpm lint           # lint and format
pnpm build          # build ESM + CJS output
```

## License

[MIT](LICENSE)
