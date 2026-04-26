#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceConfigPath = join(root, "obscura-source.json");
const vendorDir = join(root, "vendor");
const checkoutDir = join(vendorDir, "obscura");
const patchesDir = join(root, "patches");
const seriesPath = join(patchesDir, "series");
const statePath = join(vendorDir, ".node-obscura-state.json");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: process.env,
    stdio: options.stdio ?? "inherit",
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }

  return result;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readSeries() {
  if (!existsSync(seriesPath)) {
    return [];
  }

  return readFileSync(seriesPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function patchFingerprint(patchNames) {
  const hash = createHash("sha256");
  for (const patchName of patchNames) {
    const patchPath = join(patchesDir, patchName);
    hash.update(patchName);
    hash.update("\0");
    hash.update(readFileSync(patchPath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function currentCommit() {
  if (!existsSync(join(checkoutDir, ".git"))) {
    return null;
  }

  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: checkoutDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return result.status === 0 ? result.stdout.trim() : null;
}

function sourceCommitIsAncestor(source) {
  if (!existsSync(join(checkoutDir, ".git"))) {
    return false;
  }

  const result = spawnSync("git", ["merge-base", "--is-ancestor", source.commit, "HEAD"], {
    cwd: checkoutDir,
    stdio: "ignore"
  });

  return result.status === 0;
}

function readState() {
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    return readJson(statePath);
  } catch {
    return null;
  }
}

function shouldSkipBuild(source, patchesHash) {
  const state = readState();
  return Boolean(
    state &&
      state.repo === source.repo &&
      state.commit === source.commit &&
      state.patchesHash === patchesHash &&
      state.patchesCommitted === true &&
      sourceCommitIsAncestor(source) &&
      hasNativeBinding()
  );
}

function hasNativeBinding() {
  if (!existsSync(root)) {
    return false;
  }
  return readdirSync(root).some((entry) => /^node-obscura\..+\.node$/.test(entry));
}

function ensureCheckout(source) {
  mkdirSync(vendorDir, { recursive: true });

  if (!existsSync(join(checkoutDir, ".git"))) {
    rmSync(checkoutDir, { recursive: true, force: true });
    run("git", ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "clone", source.repo, checkoutDir]);
  } else {
    run("git", ["remote", "set-url", "origin", source.repo], { cwd: checkoutDir });
    run("git", ["fetch", "--tags", "origin"], { cwd: checkoutDir });
  }

  run("git", ["config", "core.autocrlf", "false"], { cwd: checkoutDir });
  run("git", ["config", "core.eol", "lf"], { cwd: checkoutDir });
  run("git", ["fetch", "origin", source.commit], { cwd: checkoutDir });
  run("git", ["checkout", "--detach", source.commit], { cwd: checkoutDir });
  run("git", ["reset", "--hard", source.commit], { cwd: checkoutDir });
  run("git", ["clean", "-fdx"], { cwd: checkoutDir });
  ensureLocalGitExclude();
}

function ensureLocalGitExclude() {
  const excludePath = join(checkoutDir, ".git", "info", "exclude");
  const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  if (!existing.split(/\r?\n/).includes("target/")) {
    writeFileSync(excludePath, `${existing.trimEnd()}\ntarget/\n`);
  }
}

function applyPatches(patchNames) {
  for (const patchName of patchNames) {
    const patchPath = join(patchesDir, patchName);
    if (!existsSync(patchPath)) {
      throw new Error(`Patch listed in patches/series does not exist: ${patchName}`);
    }
    run("git", ["apply", "--ignore-space-change", "--ignore-whitespace", patchPath], { cwd: checkoutDir });
  }
}

function commitAppliedPatches(patchNames) {
  if (patchNames.length === 0) {
    return;
  }

  run("git", ["add", "-A"], { cwd: checkoutDir });
  run(
    "git",
    [
      "-c",
      "user.name=node-obscura setup",
      "-c",
      "user.email=node-obscura@example.invalid",
      "commit",
      "--no-gpg-sign",
      "-m",
      "Apply node-obscura patches"
    ],
    { cwd: checkoutDir }
  );
}

function writeState(source, patchesHash) {
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        repo: source.repo,
        commit: source.commit,
        patchesHash,
        patchesCommitted: true,
        vendorHead: currentCommit(),
        nativeBindings: readdirSync(root).filter((entry) => /^node-obscura\..+\.node$/.test(entry)),
        installedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`
  );
}

function main() {
  if (process.env.NODE_OBSCURA_SKIP_SOURCE_SETUP === "1") {
    console.log("node-obscura: skipping Obscura source setup because NODE_OBSCURA_SKIP_SOURCE_SETUP=1");
    return;
  }

  const source = readJson(sourceConfigPath);
  const patchNames = readSeries();
  const patchesHash = patchFingerprint(patchNames);

  if (shouldSkipBuild(source, patchesHash)) {
    ensureLocalGitExclude();
    console.log(`node-obscura: Obscura ${source.commit} is already built`);
    return;
  }

  console.log(`node-obscura: preparing Obscura ${source.commit}`);
  ensureCheckout(source);
  applyPatches(patchNames);
  commitAppliedPatches(patchNames);

  if (process.env.NODE_OBSCURA_SKIP_NATIVE_BUILD === "1") {
    console.log("node-obscura: skipping native addon build because NODE_OBSCURA_SKIP_NATIVE_BUILD=1");
    writeState(source, patchesHash);
    return;
  }

  console.log("node-obscura: building native Node addon");
  run("npm", ["run", "build:native"]);
  writeState(source, patchesHash);
}

try {
  main();
} catch (error) {
  console.error(`node-obscura: ${error.message}`);
  process.exit(1);
}
