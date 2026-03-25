import { describe, expect, it } from "vitest";
import { SolTxError, SolTxErrorCode } from "../src/errors.js";
import {
  sanitizeUrl,
  validateNonNegativeInt,
  validateNonNegativeNumber,
  validatePositiveNumber,
} from "../src/validation.js";

describe("validation", () => {
  describe("validateNonNegativeInt", () => {
    it("accepts 0", () => {
      expect(() => validateNonNegativeInt(0, "test")).not.toThrow();
    });

    it("accepts 1", () => {
      expect(() => validateNonNegativeInt(1, "test")).not.toThrow();
    });

    it("accepts 50", () => {
      expect(() => validateNonNegativeInt(50, "test")).not.toThrow();
    });

    it("rejects -1", () => {
      expect(() => validateNonNegativeInt(-1, "test")).toThrow(SolTxError);
      expect(() => validateNonNegativeInt(-1, "test")).toThrow("non-negative finite integer");
    });

    it("rejects NaN", () => {
      expect(() => validateNonNegativeInt(Number.NaN, "test")).toThrow(SolTxError);
    });

    it("rejects Infinity", () => {
      expect(() => validateNonNegativeInt(Number.POSITIVE_INFINITY, "test")).toThrow(SolTxError);
    });

    it("rejects -Infinity", () => {
      expect(() => validateNonNegativeInt(Number.NEGATIVE_INFINITY, "test")).toThrow(SolTxError);
    });

    it("rejects 1.5 (not an integer)", () => {
      expect(() => validateNonNegativeInt(1.5, "test")).toThrow(SolTxError);
    });

    it("rejects values greater than max", () => {
      expect(() => validateNonNegativeInt(101, "test", 100)).toThrow(SolTxError);
      expect(() => validateNonNegativeInt(101, "test", 100)).toThrow("<= 100");
    });

    it("accepts values equal to max", () => {
      expect(() => validateNonNegativeInt(100, "test", 100)).not.toThrow();
    });

    it("accepts values below max", () => {
      expect(() => validateNonNegativeInt(50, "test", 100)).not.toThrow();
    });

    it("throws SolTxError with INVALID_ARGUMENT code", () => {
      try {
        validateNonNegativeInt(-1, "myParam");
      } catch (e) {
        expect(e).toBeInstanceOf(SolTxError);
        expect((e as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((e as SolTxError).message).toContain("myParam");
      }
    });
  });

  describe("validatePositiveNumber", () => {
    it("accepts 1", () => {
      expect(() => validatePositiveNumber(1, "test")).not.toThrow();
    });

    it("accepts 0.5", () => {
      expect(() => validatePositiveNumber(0.5, "test")).not.toThrow();
    });

    it("accepts 1000", () => {
      expect(() => validatePositiveNumber(1000, "test")).not.toThrow();
    });

    it("rejects 0", () => {
      expect(() => validatePositiveNumber(0, "test")).toThrow(SolTxError);
      expect(() => validatePositiveNumber(0, "test")).toThrow("positive finite number");
    });

    it("rejects -1", () => {
      expect(() => validatePositiveNumber(-1, "test")).toThrow(SolTxError);
    });

    it("rejects NaN", () => {
      expect(() => validatePositiveNumber(Number.NaN, "test")).toThrow(SolTxError);
    });

    it("rejects Infinity", () => {
      expect(() => validatePositiveNumber(Number.POSITIVE_INFINITY, "test")).toThrow(SolTxError);
    });

    it("rejects -Infinity", () => {
      expect(() => validatePositiveNumber(Number.NEGATIVE_INFINITY, "test")).toThrow(SolTxError);
    });

    it("throws SolTxError with INVALID_ARGUMENT code", () => {
      try {
        validatePositiveNumber(0, "myParam");
      } catch (e) {
        expect(e).toBeInstanceOf(SolTxError);
        expect((e as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((e as SolTxError).message).toContain("myParam");
      }
    });
  });

  describe("validateNonNegativeNumber", () => {
    it("accepts 0", () => {
      expect(() => validateNonNegativeNumber(0, "test")).not.toThrow();
    });

    it("accepts 1", () => {
      expect(() => validateNonNegativeNumber(1, "test")).not.toThrow();
    });

    it("accepts 0.5", () => {
      expect(() => validateNonNegativeNumber(0.5, "test")).not.toThrow();
    });

    it("rejects -1", () => {
      expect(() => validateNonNegativeNumber(-1, "test")).toThrow(SolTxError);
      expect(() => validateNonNegativeNumber(-1, "test")).toThrow("non-negative finite number");
    });

    it("rejects NaN", () => {
      expect(() => validateNonNegativeNumber(Number.NaN, "test")).toThrow(SolTxError);
    });

    it("rejects Infinity", () => {
      expect(() => validateNonNegativeNumber(Number.POSITIVE_INFINITY, "test")).toThrow(SolTxError);
    });

    it("rejects -Infinity", () => {
      expect(() => validateNonNegativeNumber(Number.NEGATIVE_INFINITY, "test")).toThrow(SolTxError);
    });

    it("throws SolTxError with INVALID_ARGUMENT code", () => {
      try {
        validateNonNegativeNumber(-1, "myParam");
      } catch (e) {
        expect(e).toBeInstanceOf(SolTxError);
        expect((e as SolTxError).code).toBe(SolTxErrorCode.INVALID_ARGUMENT);
        expect((e as SolTxError).message).toContain("myParam");
      }
    });
  });

  describe("sanitizeUrl", () => {
    it("strips query params from URL", () => {
      const result = sanitizeUrl("https://rpc.com?api-key=SECRET");
      expect(result).toBe("https://rpc.com/");
      expect(result).not.toContain("SECRET");
      expect(result).not.toContain("api-key");
    });

    it("strips multiple query params", () => {
      const result = sanitizeUrl("https://rpc.com/v1?api-key=SECRET&token=abc123");
      expect(result).not.toContain("SECRET");
      expect(result).not.toContain("abc123");
    });

    it("masks long path segments (20+ alphanumeric chars)", () => {
      const result = sanitizeUrl("https://rpc.com/v1/abc123456789012345678901");
      expect(result).toBe("https://rpc.com/v1/***");
      expect(result).not.toContain("abc123456789012345678901");
    });

    it("preserves short path segments", () => {
      const result = sanitizeUrl("https://rpc.com/v1/short");
      expect(result).toBe("https://rpc.com/v1/short");
    });

    it("returns protocol + host for clean URLs", () => {
      const result = sanitizeUrl("https://rpc.example.com");
      expect(result).toBe("https://rpc.example.com/");
    });

    it("returns protocol + host + path for clean URLs with short paths", () => {
      const result = sanitizeUrl("https://rpc.example.com/v1");
      expect(result).toBe("https://rpc.example.com/v1");
    });

    it("returns '***invalid-url***' for invalid input", () => {
      expect(sanitizeUrl("not-a-url")).toBe("***invalid-url***");
    });

    it("returns '***invalid-url***' for empty string", () => {
      expect(sanitizeUrl("")).toBe("***invalid-url***");
    });

    it("strips hash fragments", () => {
      const result = sanitizeUrl("https://rpc.com/v1#fragment");
      expect(result).not.toContain("fragment");
    });

    it("masks multiple long path segments", () => {
      const result = sanitizeUrl("https://rpc.com/abc12345678901234567890/xyz12345678901234567890");
      expect(result).toBe("https://rpc.com/***/***");
    });
  });
});
