# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
