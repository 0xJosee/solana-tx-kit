/** Error codes for all solana-tx-kit error types */
export enum SolTxErrorCode {
  RETRIES_EXHAUSTED = "RETRIES_EXHAUSTED",
  NON_RETRYABLE = "NON_RETRYABLE",

  BLOCKHASH_EXPIRED = "BLOCKHASH_EXPIRED",
  BLOCKHASH_FETCH_FAILED = "BLOCKHASH_FETCH_FAILED",

  SIMULATION_FAILED = "SIMULATION_FAILED",
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",

  CONFIRMATION_TIMEOUT = "CONFIRMATION_TIMEOUT",
  TRANSACTION_FAILED = "TRANSACTION_FAILED",

  ALL_ENDPOINTS_UNHEALTHY = "ALL_ENDPOINTS_UNHEALTHY",
  RATE_LIMITED = "RATE_LIMITED",

  BUNDLE_FAILED = "BUNDLE_FAILED",
  BUNDLE_DROPPED = "BUNDLE_DROPPED",
  TIP_TOO_LOW = "TIP_TOO_LOW",

  FEE_ESTIMATION_FAILED = "FEE_ESTIMATION_FAILED",
}

/** Structured error with a machine-readable code and optional cause/context */
export class SolTxError extends Error {
  readonly code: SolTxErrorCode;
  override readonly cause?: Error | undefined;
  readonly context?: Record<string, unknown> | undefined;

  constructor(
    code: SolTxErrorCode,
    message: string,
    options?: { cause?: Error | undefined; context?: Record<string, unknown> | undefined },
  ) {
    super(message);
    this.name = "SolTxError";
    this.code = code;
    this.cause = options?.cause;
    this.context = options?.context;
  }
}

/** A SolTxError that indicates the operation can be retried after a delay */
export class RetryableError extends SolTxError {
  readonly retryAfterMs?: number | undefined;

  constructor(
    code: SolTxErrorCode,
    message: string,
    options?: {
      cause?: Error | undefined;
      context?: Record<string, unknown> | undefined;
      retryAfterMs?: number | undefined;
    },
  ) {
    super(code, message, options);
    this.name = "RetryableError";
    this.retryAfterMs = options?.retryAfterMs;
  }
}
