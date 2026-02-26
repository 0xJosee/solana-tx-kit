import type { Logger } from "./types.js";

/** Create a console-based logger with `[solana-tx-kit]` prefix. Pass your own Logger to override. */
export function createDefaultLogger(): Logger {
  return {
    debug(msg, data) {
      console.debug(`[solana-tx-kit] ${msg}`, data ?? "");
    },
    info(msg, data) {
      console.info(`[solana-tx-kit] ${msg}`, data ?? "");
    },
    warn(msg, data) {
      console.warn(`[solana-tx-kit] ${msg}`, data ?? "");
    },
    error(msg, data) {
      console.error(`[solana-tx-kit] ${msg}`, data ?? "");
    },
  };
}
