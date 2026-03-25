import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultLogger } from "../src/logger.js";

describe("createDefaultLogger", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an object with debug, info, warn, error methods", () => {
    const logger = createDefaultLogger();

    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("debug() calls console.debug with prefixed message", () => {
    const logger = createDefaultLogger();
    logger.debug("test message", { key: "value" });

    expect(debugSpy).toHaveBeenCalledWith("[solana-tx-kit] test message", { key: "value" });
  });

  it("info() calls console.info with prefixed message", () => {
    const logger = createDefaultLogger();
    logger.info("info message", { count: 42 });

    expect(infoSpy).toHaveBeenCalledWith("[solana-tx-kit] info message", { count: 42 });
  });

  it("warn() calls console.warn with prefixed message", () => {
    const logger = createDefaultLogger();
    logger.warn("warning message");

    expect(warnSpy).toHaveBeenCalledWith("[solana-tx-kit] warning message", "");
  });

  it("error() calls console.error with prefixed message", () => {
    const logger = createDefaultLogger();
    logger.error("error message", { err: "something" });

    expect(errorSpy).toHaveBeenCalledWith("[solana-tx-kit] error message", { err: "something" });
  });

  it("passes empty string as data when data argument is omitted", () => {
    const logger = createDefaultLogger();
    logger.debug("no data");
    logger.info("no data");

    expect(debugSpy).toHaveBeenCalledWith("[solana-tx-kit] no data", "");
    expect(infoSpy).toHaveBeenCalledWith("[solana-tx-kit] no data", "");
  });
});
