import { describe, expect, it } from "vitest";
import { SolTxError, SolTxErrorCode } from "../../src/errors.js";
import { estimatePriorityFee } from "../../src/priority-fee/fee-estimator.js";
import { createMockConnection } from "../helpers/mock-connection.js";

describe("estimatePriorityFee", () => {
  it("computes percentile-based fee from mock data", async () => {
    const conn = createMockConnection();
    const result = await estimatePriorityFee(conn);

    expect(result.sampleCount).toBeGreaterThan(0);
    expect(result.microLamports).toBeGreaterThanOrEqual(1_000); // min clamp
    expect(result.microLamports).toBeLessThanOrEqual(1_000_000); // max clamp
    expect(result.percentiles.p50).toBeDefined();
    expect(result.percentiles.p75).toBeDefined();
    expect(result.percentiles.p90).toBeDefined();
    // p50 <= p75 <= p90
    expect(result.percentiles.p50).toBeLessThanOrEqual(result.percentiles.p75);
    expect(result.percentiles.p75).toBeLessThanOrEqual(result.percentiles.p90);
  });

  it("respects min/max clamps", async () => {
    const conn = createMockConnection({
      getRecentPrioritizationFees: async () => [{ slot: 1, prioritizationFee: 1 }],
    });
    const result = await estimatePriorityFee(conn, { minMicroLamports: 500 });
    expect(result.microLamports).toBeGreaterThanOrEqual(500);
  });

  it("respects max clamp", async () => {
    const conn = createMockConnection({
      getRecentPrioritizationFees: async () => [{ slot: 1, prioritizationFee: 999_999_999 }],
    });
    const result = await estimatePriorityFee(conn, { maxMicroLamports: 100_000 });
    expect(result.microLamports).toBeLessThanOrEqual(100_000);
  });

  it("handles empty fee data gracefully", async () => {
    const conn = createMockConnection({
      getRecentPrioritizationFees: async () => [],
    });
    const result = await estimatePriorityFee(conn);
    expect(result.sampleCount).toBe(0);
    // Should return min since no data
    expect(result.microLamports).toBe(1_000);
  });

  it("targets p90 when configured", async () => {
    const conn = createMockConnection();
    const p75result = await estimatePriorityFee(conn, { targetPercentile: 75 });
    const p90result = await estimatePriorityFee(conn, { targetPercentile: 90 });
    expect(p90result.microLamports).toBeGreaterThanOrEqual(p75result.microLamports);
  });

  it("targets p50 when configured", async () => {
    const conn = createMockConnection();
    const p50result = await estimatePriorityFee(conn, { targetPercentile: 50 });
    const p75result = await estimatePriorityFee(conn, { targetPercentile: 75 });
    expect(p50result.microLamports).toBeLessThanOrEqual(p75result.microLamports);
    expect(p50result.percentiles.p50).toBeDefined();
  });

  it("throws FEE_ESTIMATION_FAILED when RPC call rejects", async () => {
    const conn = createMockConnection({
      getRecentPrioritizationFees: async () => {
        throw new Error("RPC unavailable");
      },
    });
    try {
      await estimatePriorityFee(conn);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SolTxError);
      expect((err as SolTxError).code).toBe(SolTxErrorCode.FEE_ESTIMATION_FAILED);
      expect((err as SolTxError).message).toContain("Failed to estimate priority fees");
    }
  });

  describe("config validation", () => {
    it("throws INVALID_ARGUMENT when minMicroLamports is NaN", async () => {
      const conn = createMockConnection();
      await expect(estimatePriorityFee(conn, { minMicroLamports: Number.NaN })).rejects.toThrow(SolTxError);

      try {
        await estimatePriorityFee(conn, { minMicroLamports: Number.NaN });
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((err as SolTxError).message).toContain("minMicroLamports");
      }
    });

    it("throws INVALID_ARGUMENT when minMicroLamports > maxMicroLamports", async () => {
      const conn = createMockConnection();
      await expect(estimatePriorityFee(conn, { minMicroLamports: 500_000, maxMicroLamports: 100_000 })).rejects.toThrow(
        SolTxError,
      );

      try {
        await estimatePriorityFee(conn, { minMicroLamports: 500_000, maxMicroLamports: 100_000 });
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((err as SolTxError).message).toContain("minMicroLamports");
        expect((err as SolTxError).message).toContain("maxMicroLamports");
      }
    });

    it("throws INVALID_ARGUMENT when maxMicroLamports is negative", async () => {
      const conn = createMockConnection();
      await expect(estimatePriorityFee(conn, { maxMicroLamports: -1 })).rejects.toThrow(SolTxError);

      try {
        await estimatePriorityFee(conn, { maxMicroLamports: -1 });
      } catch (err) {
        expect((err as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((err as SolTxError).message).toContain("maxMicroLamports");
      }
    });
  });
});
