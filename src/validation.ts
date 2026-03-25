import { SolTxError, SolTxErrorCode } from "./errors.js";

/** Validate that a number is a finite integer >= 0, optionally capped */
export function validateNonNegativeInt(value: number, name: string, max?: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new SolTxError(
      SolTxErrorCode.INVALID_ARGUMENT,
      `${name} must be a non-negative finite integer, got ${value}`,
    );
  }
  if (max !== undefined && value > max) {
    throw new SolTxError(SolTxErrorCode.INVALID_ARGUMENT, `${name} must be <= ${max}, got ${value}`);
  }
}

/** Validate that a number is finite and > 0 */
export function validatePositiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new SolTxError(SolTxErrorCode.INVALID_ARGUMENT, `${name} must be a positive finite number, got ${value}`);
  }
}

/** Validate that a number is finite and >= 0 */
export function validateNonNegativeNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new SolTxError(SolTxErrorCode.INVALID_ARGUMENT, `${name} must be a non-negative finite number, got ${value}`);
  }
}

/**
 * Sanitize a URL for logging: strips query parameters and masks long path segments
 * that likely contain API keys. Never log raw RPC URLs.
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    // Mask path segments that look like API keys (long alphanumeric strings)
    const sanitizedPath = parsed.pathname.replace(/\/[A-Za-z0-9_-]{20,}/g, "/***");
    return `${parsed.protocol}//${parsed.host}${sanitizedPath}`;
  } catch {
    return "***invalid-url***";
  }
}
