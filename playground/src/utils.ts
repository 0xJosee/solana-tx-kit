import { Connection, Keypair } from "@solana/web3.js";
import { config } from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "solana-tx-kit";

config({ path: resolve(import.meta.dirname, "../.env") });

// ── Colors ──────────────────────────────────────────────────────────
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";

export const c = {
  ok: (s: string) => `${GREEN}${s}${RESET}`,
  fail: (s: string) => `${RED}${s}${RESET}`,
  warn: (s: string) => `${YELLOW}${s}${RESET}`,
  info: (s: string) => `${CYAN}${s}${RESET}`,
  accent: (s: string) => `${MAGENTA}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  blue: (s: string) => `${BLUE}${s}${RESET}`,
};

// ── Section header ──────────────────────────────────────────────────
export function section(title: string) {
  const line = "─".repeat(60);
  console.log(`\n${c.blue(line)}`);
  console.log(`  ${c.bold(title)}`);
  console.log(`${c.blue(line)}\n`);
}

export function step(label: string) {
  console.log(`  ${c.accent("▸")} ${label}`);
}

export function pass(label: string) {
  console.log(`  ${c.ok("✓")} ${label}`);
}

export function fail(label: string, err?: unknown) {
  console.log(`  ${c.fail("✗")} ${label}`);
  if (err) console.log(`    ${c.dim(String(err))}`);
}

// ── Keypair loading ─────────────────────────────────────────────────
export function loadKeypair(): Keypair {
  const keypairPath = process.env.KEYPAIR_PATH;
  if (!keypairPath) {
    throw new Error("KEYPAIR_PATH not set in .env — see .env.example");
  }

  const resolved = resolve(import.meta.dirname, "..", keypairPath);
  if (!existsSync(resolved)) {
    throw new Error(
      `Keypair file not found: ${resolved}\n` +
        "Generate one: solana-keygen new --outfile ./devnet-keypair.json\n" +
        "Fund it:      solana airdrop 2 <PUBKEY> --url devnet",
    );
  }

  const raw = JSON.parse(readFileSync(resolved, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// ── Connection factory ──────────────────────────────────────────────
export function getConnection(urlOverride?: string): Connection {
  const url = urlOverride ?? process.env.RPC_URL ?? "https://api.devnet.solana.com";
  return new Connection(url, "confirmed");
}

export function getRpcUrls(): string[] {
  const urls: string[] = [];
  if (process.env.RPC_URL) urls.push(process.env.RPC_URL);
  if (process.env.RPC_URL_2) urls.push(process.env.RPC_URL_2);
  if (process.env.RPC_URL_3) urls.push(process.env.RPC_URL_3);
  if (urls.length === 0) urls.push("https://api.devnet.solana.com");
  return urls;
}

// ── Pretty logger ───────────────────────────────────────────────────
export const prettyLogger: Logger = {
  debug(msg, data) {
    console.log(`    ${c.dim("[debug]")} ${msg}`, data ? c.dim(JSON.stringify(data)) : "");
  },
  info(msg, data) {
    console.log(`    ${c.info("[info]")}  ${msg}`, data ? c.dim(JSON.stringify(data)) : "");
  },
  warn(msg, data) {
    console.log(`    ${c.warn("[warn]")}  ${msg}`, data ? c.dim(JSON.stringify(data)) : "");
  },
  error(msg, data) {
    console.log(`    ${c.fail("[error]")} ${msg}`, data ? c.dim(JSON.stringify(data)) : "");
  },
};

// ── Timer ───────────────────────────────────────────────────────────
export function timer(): () => number {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}

// ── Run wrapper ─────────────────────────────────────────────────────
export async function runTest(name: string, fn: () => Promise<void>): Promise<boolean> {
  section(name);
  try {
    await fn();
    console.log(`\n  ${c.ok("PASSED")}\n`);
    return true;
  } catch (err) {
    fail("Test failed", err);
    if (err instanceof Error && err.stack) {
      console.log(`    ${c.dim(err.stack.split("\n").slice(1, 4).join("\n    "))}`);
    }
    console.log(`\n  ${c.fail("FAILED")}\n`);
    return false;
  }
}
