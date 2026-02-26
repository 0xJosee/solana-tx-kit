import type { Connection } from "@solana/web3.js";
import { vi } from "vitest";

export function createMockConnection(overrides?: Partial<Record<string, unknown>>): Connection {
  return {
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: "MockBlockhash111111111111111111111111111111",
      lastValidBlockHeight: 200_000_000,
    }),
    getBlockHeight: vi.fn().mockResolvedValue(199_999_900),
    sendRawTransaction: vi.fn().mockResolvedValue("MockSig111111111111111111111111111111111111111"),
    simulateTransaction: vi.fn().mockResolvedValue({
      context: { slot: 100 },
      value: { err: null, logs: ["Program log: success"], unitsConsumed: 50_000 },
    }),
    getSignatureStatuses: vi.fn().mockResolvedValue({
      context: { slot: 100 },
      value: [{ slot: 100, confirmations: 1, err: null, confirmationStatus: "confirmed" }],
    }),
    getRecentPrioritizationFees: vi
      .fn()
      .mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ slot: 100 + i, prioritizationFee: (i + 1) * 100 }))),
    onSignature: vi.fn().mockReturnValue(1),
    removeSignatureListener: vi.fn().mockResolvedValue(undefined),
    getHealth: vi.fn().mockResolvedValue("ok"),
    getSlot: vi.fn().mockResolvedValue(100),
    ...overrides,
  } as unknown as Connection;
}
