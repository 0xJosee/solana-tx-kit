import { SolTxError, SolTxErrorCode } from "../errors.js";

export interface ErrorClassification {
  retryable: boolean;
  /** If true, the transaction must be re-signed with a fresh blockhash before retrying */
  needsResign: boolean;
  errorType: string;
}

const RETRYABLE_MESSAGES = [
  "blockhash not found",
  "block height exceeded",
  "TransactionExpiredBlockheightExceeded",
  "Node is behind",
  "node is unhealthy",
  "Service unavailable",
  "Too many requests",
];

const NEEDS_RESIGN_MESSAGES = ["blockhash not found", "block height exceeded", "TransactionExpiredBlockheightExceeded"];

const NETWORK_ERROR_CODES = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "EPIPE"];

const NON_RETRYABLE_MESSAGES = [
  "insufficient funds",
  "Insufficient funds",
  "invalid account data",
  "Account not found",
  "Signature verification failed",
  "Transaction simulation failed: Error processing Instruction",
  "Program failed to complete",
  "already been processed",
];

/** Classify an error as retryable or non-retryable based on message patterns and error codes */
export function classifyError(error: Error): ErrorClassification {
  const msg = error.message ?? "";
  const code = (error as NodeJS.ErrnoException).code;

  // Check non-retryable first
  for (const pattern of NON_RETRYABLE_MESSAGES) {
    if (msg.includes(pattern)) {
      return { retryable: false, needsResign: false, errorType: pattern };
    }
  }

  // Check typed BLOCKHASH_EXPIRED before network/message loops
  if (isBlockhashExpired(error)) {
    return { retryable: true, needsResign: true, errorType: "BLOCKHASH_EXPIRED" };
  }

  // Check network errors by code
  if (code && NETWORK_ERROR_CODES.includes(code)) {
    return { retryable: true, needsResign: false, errorType: code };
  }

  // HTTP status code detection
  if (msg.includes("429") || msg.includes("Too many requests")) {
    return { retryable: true, needsResign: false, errorType: "RATE_LIMITED" };
  }
  if (msg.includes("503") || msg.includes("Service unavailable")) {
    return { retryable: true, needsResign: false, errorType: "SERVICE_UNAVAILABLE" };
  }

  // Check retryable message patterns
  for (const pattern of RETRYABLE_MESSAGES) {
    if (msg.includes(pattern)) {
      const needsResign = NEEDS_RESIGN_MESSAGES.some((p) => msg.includes(p));
      return { retryable: true, needsResign, errorType: pattern };
    }
  }

  // Default: non-retryable
  return { retryable: false, needsResign: false, errorType: "UNKNOWN" };
}

export function isBlockhashExpired(error: Error): boolean {
  if (error instanceof SolTxError && error.code === SolTxErrorCode.BLOCKHASH_EXPIRED) return true;
  const msg = error.message ?? "";
  return NEEDS_RESIGN_MESSAGES.some((pattern) => msg.includes(pattern));
}

export function isRateLimited(error: Error): boolean {
  const msg = error.message ?? "";
  return msg.includes("429") || msg.includes("Too many requests");
}
