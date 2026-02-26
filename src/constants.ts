import { PublicKey } from "@solana/web3.js";

export const JITO_TIP_ACCOUNTS: readonly PublicKey[] = Object.freeze([
  new PublicKey("96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5"),
  new PublicKey("HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe"),
  new PublicKey("Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY"),
  new PublicKey("ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49"),
  new PublicKey("DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh"),
  new PublicKey("ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt"),
  new PublicKey("DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL"),
  new PublicKey("3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"),
]);

export const JITO_BLOCK_ENGINE_URL = "https://mainnet.block-engine.jito.wtf";
export const JITO_MIN_TIP_LAMPORTS = 1_000;

export const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  backoffMultiplier: 2,
} as const;

export const DEFAULT_PRIORITY_FEE_CONFIG = {
  targetPercentile: 75 as const,
  maxMicroLamports: 1_000_000,
  minMicroLamports: 1_000,
  defaultComputeUnits: 200_000,
} as const;

export const DEFAULT_CONFIRMATION_CONFIG = {
  commitment: "confirmed" as const,
  timeoutMs: 60_000,
  pollIntervalMs: 2_000,
  useWebSocket: true,
} as const;

export const DEFAULT_BLOCKHASH_CONFIG = {
  ttlMs: 60_000,
  refreshIntervalMs: 30_000,
  commitment: "confirmed" as const,
} as const;
