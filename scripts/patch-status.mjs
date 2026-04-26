#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkoutDir = join(root, "vendor", "obscura");
const sourcePathspec = [".", ":(exclude)target", ":(exclude)target/**"];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: checkoutDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const details = result.stderr ? `\n${result.stderr.trim()}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${details}`);
  }

  return result.stdout;
}

try {
  if (!existsSync(join(checkoutDir, ".git"))) {
    throw new Error("vendor/obscura is missing. Run `npm run setup` first.");
  }

  const status = run("git", ["status", "--short", "--", ...sourcePathspec]).trim();
  if (!status) {
    console.log("node-obscura: no Obscura source changes under vendor/obscura");
  } else {
    console.log(status);
    console.log("node-obscura: run `npm run patch:generate -- <patch-name>` before committing");
  }
} catch (error) {
  console.error(`node-obscura: ${error.message}`);
  process.exit(1);
}
