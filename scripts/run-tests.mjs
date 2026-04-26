#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testDir = join(root, "test");

function collectTests(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectTests(path);
      }
      return entry.isFile() && entry.name.endsWith(".test.js") ? [path] : [];
    })
    .sort();
}

const testFiles = collectTests(testDir);
if (testFiles.length === 0) {
  console.error("No test files found");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
  shell: false
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
