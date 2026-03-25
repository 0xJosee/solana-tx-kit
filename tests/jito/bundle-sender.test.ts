import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolTxError, SolTxErrorCode } from "../../src/errors.js";
import { JitoBundleSender } from "../../src/jito/bundle-sender.js";
import { BundleStatus } from "../../src/jito/types.js";

describe("JitoBundleSender", () => {
  describe("constructor URL validation", () => {
    it("accepts https:// URLs", () => {
      expect(
        () =>
          new JitoBundleSender({
            blockEngineUrl: "https://mainnet.block-engine.jito.wtf",
            tipPayer: Keypair.generate(),
          }),
      ).not.toThrow();
    });

    it("rejects http:// URLs by default", () => {
      expect(
        () =>
          new JitoBundleSender({
            blockEngineUrl: "http://mainnet.block-engine.jito.wtf",
            tipPayer: Keypair.generate(),
          }),
      ).toThrow(SolTxError);

      try {
        new JitoBundleSender({
          blockEngineUrl: "http://mainnet.block-engine.jito.wtf",
          tipPayer: Keypair.generate(),
        });
      } catch (e) {
        expect(e).toBeInstanceOf(SolTxError);
        expect((e as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((e as SolTxError).message).toContain("Insecure HTTP");
      }
    });

    it("accepts http:// URLs when allowInsecureHttp is true", () => {
      expect(
        () =>
          new JitoBundleSender({
            blockEngineUrl: "http://localhost:8899",
            tipPayer: Keypair.generate(),
            allowInsecureHttp: true,
          }),
      ).not.toThrow();
    });

    it("rejects URLs without protocol", () => {
      expect(
        () =>
          new JitoBundleSender({
            blockEngineUrl: "not-a-url",
            tipPayer: Keypair.generate(),
          }),
      ).toThrow(SolTxError);

      try {
        new JitoBundleSender({
          blockEngineUrl: "not-a-url",
          tipPayer: Keypair.generate(),
        });
      } catch (e) {
        expect(e).toBeInstanceOf(SolTxError);
        expect((e as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((e as SolTxError).message).toContain("must start with https://");
      }
    });

    it("rejects ftp:// URLs", () => {
      expect(
        () =>
          new JitoBundleSender({
            blockEngineUrl: "ftp://example.com",
            tipPayer: Keypair.generate(),
          }),
      ).toThrow(SolTxError);
    });
  });

  describe("sendBundle()", () => {
    let keypair: Keypair;
    let sender: JitoBundleSender;

    function createSignedTransaction(): Transaction {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: new PublicKey("11111111111111111111111111111111"),
          lamports: 1000,
        }),
      );
      tx.recentBlockhash = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
      tx.feePayer = keypair.publicKey;
      tx.sign(keypair);
      return tx;
    }

    beforeEach(() => {
      keypair = Keypair.generate();
      sender = new JitoBundleSender({
        blockEngineUrl: "https://mainnet.block-engine.jito.wtf",
        tipPayer: keypair,
        statusPollIntervalMs: 10,
        statusTimeoutMs: 100,
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("throws BUNDLE_FAILED when transactions array is empty", async () => {
      try {
        await sender.sendBundle([]);
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(SolTxError);
        expect((e as SolTxError).code).toBe(SolTxErrorCode.BUNDLE_FAILED);
        expect((e as SolTxError).message).toContain("1-5 transactions");
      }
    });

    it("throws BUNDLE_FAILED when transactions array has > 5 items", async () => {
      const txs = Array.from({ length: 6 }, () => createSignedTransaction());
      try {
        await sender.sendBundle(txs);
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(SolTxError);
        expect((e as SolTxError).code).toBe(SolTxErrorCode.BUNDLE_FAILED);
        expect((e as SolTxError).message).toContain("1-5 transactions");
        expect((e as SolTxError).message).toContain("6");
      }
    });

    it("submits bundle and returns SUBMITTED status when waitForConfirmation=false", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "bundle-id-123" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const tx = createSignedTransaction();
      const result = await sender.sendBundle([tx], { waitForConfirmation: false });

      expect(result.bundleId).toBe("bundle-id-123");
      expect(result.status).toBe(BundleStatus.SUBMITTED);
    });

    it("calls fetch with correct JSON-RPC body (method: sendBundle)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: "bundle-id-456" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const tx = createSignedTransaction();
      await sender.sendBundle([tx], { waitForConfirmation: false });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://mainnet.block-engine.jito.wtf/api/v1/bundles");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });

      const body = JSON.parse(options.body as string);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.method).toBe("sendBundle");
      expect(body.params).toHaveLength(1);
      // params[0] is an array of base64-serialized transactions
      expect(Array.isArray(body.params[0])).toBe(true);
      expect(body.params[0]).toHaveLength(1);
      expect(typeof body.params[0][0]).toBe("string");
    });

    it("throws BUNDLE_FAILED when fetch returns non-ok HTTP status", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal("fetch", mockFetch);

      const tx = createSignedTransaction();
      try {
        await sender.sendBundle([tx], { waitForConfirmation: false });
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(SolTxError);
        expect((e as SolTxError).code).toBe(SolTxErrorCode.BUNDLE_FAILED);
        expect((e as SolTxError).message).toContain("HTTP 503");
      }
    });

    it("throws BUNDLE_FAILED when Jito RPC returns a JSON-RPC error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32000, message: "Bundle simulation failed" },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const tx = createSignedTransaction();
      try {
        await sender.sendBundle([tx], { waitForConfirmation: false });
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(SolTxError);
        expect((e as SolTxError).code).toBe(SolTxErrorCode.BUNDLE_FAILED);
        expect((e as SolTxError).message).toContain("Bundle simulation failed");
      }
    });
  });

  describe("waitForBundleStatus()", () => {
    let keypair: Keypair;

    beforeEach(() => {
      keypair = Keypair.generate();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns LANDED when bundle is confirmed", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: "2.0",
            id: 1,
            result: {
              value: [
                {
                  bundle_id: "bundle-abc",
                  transactions: ["sig1"],
                  slot: 12345,
                  confirmation_status: "confirmed",
                  err: { Ok: null },
                },
              ],
            },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const sender = new JitoBundleSender({
        blockEngineUrl: "https://mainnet.block-engine.jito.wtf",
        tipPayer: keypair,
        statusPollIntervalMs: 10,
        statusTimeoutMs: 5000,
      });

      const result = await sender.waitForBundleStatus("bundle-abc");
      expect(result.bundleId).toBe("bundle-abc");
      expect(result.status).toBe(BundleStatus.LANDED);
      expect(result.slot).toBe(12345);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns LANDED when bundle is finalized", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: "2.0",
            id: 1,
            result: {
              value: [
                {
                  bundle_id: "bundle-fin",
                  transactions: ["sig1"],
                  slot: 99999,
                  confirmation_status: "finalized",
                  err: { Ok: null },
                },
              ],
            },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const sender = new JitoBundleSender({
        blockEngineUrl: "https://mainnet.block-engine.jito.wtf",
        tipPayer: keypair,
        statusPollIntervalMs: 10,
        statusTimeoutMs: 5000,
      });

      const result = await sender.waitForBundleStatus("bundle-fin");
      expect(result.status).toBe(BundleStatus.LANDED);
      expect(result.slot).toBe(99999);
    });

    it("returns FAILED when bundle has an error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: "2.0",
            id: 1,
            result: {
              value: [
                {
                  bundle_id: "bundle-err",
                  transactions: ["sig1"],
                  slot: 100,
                  confirmation_status: "processed",
                  err: { Err: { InstructionError: [0, "Custom"] } },
                },
              ],
            },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const sender = new JitoBundleSender({
        blockEngineUrl: "https://mainnet.block-engine.jito.wtf",
        tipPayer: keypair,
        statusPollIntervalMs: 10,
        statusTimeoutMs: 5000,
      });

      const result = await sender.waitForBundleStatus("bundle-err");
      expect(result.bundleId).toBe("bundle-err");
      expect(result.status).toBe(BundleStatus.FAILED);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns DROPPED on timeout when status never resolves", async () => {
      // Always return empty value array (bundle not found yet)
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonrpc: "2.0",
            id: 1,
            result: { value: [] },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const sender = new JitoBundleSender({
        blockEngineUrl: "https://mainnet.block-engine.jito.wtf",
        tipPayer: keypair,
        statusPollIntervalMs: 10,
        statusTimeoutMs: 50,
      });

      const result = await sender.waitForBundleStatus("bundle-timeout");
      expect(result.bundleId).toBe("bundle-timeout");
      expect(result.status).toBe(BundleStatus.DROPPED);
      expect(result.latencyMs).toBeGreaterThanOrEqual(50);
    });

    it("polls multiple times before landing", async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          // First two polls: bundle not found
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: { value: [] } }),
          });
        }
        // Third poll: bundle landed
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              jsonrpc: "2.0",
              id: 1,
              result: {
                value: [
                  {
                    bundle_id: "bundle-poll",
                    transactions: ["sig1"],
                    slot: 555,
                    confirmation_status: "confirmed",
                    err: { Ok: null },
                  },
                ],
              },
            }),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const sender = new JitoBundleSender({
        blockEngineUrl: "https://mainnet.block-engine.jito.wtf",
        tipPayer: keypair,
        statusPollIntervalMs: 10,
        statusTimeoutMs: 5000,
      });

      const result = await sender.waitForBundleStatus("bundle-poll");
      expect(result.status).toBe(BundleStatus.LANDED);
      expect(result.slot).toBe(555);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
