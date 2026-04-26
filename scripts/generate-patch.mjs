#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkoutDir = join(root, "vendor", "obscura");
const patchesDir = join(root, "patches");
const seriesPath = join(patchesDir, "series");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: options.encoding ?? "utf8",
    env: process.env,
    input: options.input,
    maxBuffer: options.maxBuffer ?? 100 * 1024 * 1024,
    stdio: options.stdio ?? (options.input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"]),
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const details = result.stderr ? `\n${result.stderr.trim()}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${details}`);
  }

  return result;
}

function usage() {
  console.error("Usage: npm run patch:generate -- <patch-name>");
  console.error("Example: npm run patch:generate -- fix-cdp-timeout");
}

function patchNameFromArg(rawName) {
  const fallback = `obscura-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const baseName = (rawName || fallback)
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/\.patch$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!baseName) {
    throw new Error("Patch name must contain at least one letter or number");
  }

  return `${baseName}.patch`;
}

function readSeries() {
  if (!existsSync(seriesPath)) {
    return [];
  }

  return readFileSync(seriesPath, "utf8").split(/\r?\n/);
}

function appendToSeries(patchFileName) {
  const lines = readSeries();
  const meaningfulLines = lines.map((line) => line.trim()).filter(Boolean);
  if (meaningfulLines.includes(patchFileName)) {
    return;
  }

  const existing = existsSync(seriesPath) ? readFileSync(seriesPath, "utf8").trimEnd() : "";
  const next = existing ? `${existing}\n${patchFileName}\n` : `${patchFileName}\n`;
  writeFileSync(seriesPath, next);
}

function ensureCheckoutExists() {
  if (!existsSync(join(checkoutDir, ".git"))) {
    throw new Error("vendor/obscura is missing. Run `npm run setup` before generating a patch.");
  }
}

function main() {
  const rawName = process.argv[2];
  if (rawName === "-h" || rawName === "--help") {
    usage();
    return;
  }

  ensureCheckoutExists();
  mkdirSync(patchesDir, { recursive: true });

  const patchFileName = patchNameFromArg(rawName);
  const patchPath = join(patchesDir, patchFileName);
  const sourcePathspec = [".", ":(exclude)target", ":(exclude)target/**"];

  run("git", ["reset", "-q"], { cwd: checkoutDir });
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", ...sourcePathspec], {
    cwd: checkoutDir
  }).stdout;
  if (untracked.length > 0) {
    run("git", ["add", "-N", "--pathspec-from-file=-", "--pathspec-file-nul"], {
      cwd: checkoutDir,
      input: untracked
    });
  }
  const diff = run("git", ["diff", "--binary", "--full-index", "--", ...sourcePathspec], { cwd: checkoutDir }).stdout;
  run("git", ["reset", "-q"], { cwd: checkoutDir });

  if (!diff.trim()) {
    throw new Error("No Rust source changes found under vendor/obscura.");
  }

  writeFileSync(patchPath, diff);
  appendToSeries(patchFileName);
  console.log(`node-obscura: wrote ${patchPath}`);
  console.log(`node-obscura: ensured ${patchFileName} is listed in patches/series`);
}

try {
  main();
} catch (error) {
  console.error(`node-obscura: ${error.message}`);
  process.exit(1);
}
