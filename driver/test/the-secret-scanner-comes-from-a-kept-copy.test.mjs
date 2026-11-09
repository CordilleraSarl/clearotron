// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// GitHub's release files answered 504 for over an hour on 2026-11-08 and a publish waited on them. The scanner now
// comes from a kept copy that matches the pinned hash, and the download is the fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchSecretScanner } from "../../scripts/secret-scanner-fetch.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSION = "9.9.9";

function world() {
  const dir = mkdtempSync(join(tmpdir(), "secret-scanner-"));
  const src = join(dir, "src"), work = join(dir, "work"), cacheDir = join(dir, "cache"), bin = join(dir, "bin");
  for (const d of [src, work, bin]) mkdirSync(d);
  writeFileSync(join(src, "gitleaks"), "invented scanner\n");
  const tgz = join(dir, "archive.tgz");
  execFileSync("tar", ["-czf", tgz, "-C", src, "gitleaks"]);
  const sha256 = createHash("sha256").update(readFileSync(tgz)).digest("hex");
  const calls = join(dir, "curl-calls");
  writeFileSync(join(bin, "curl"), `#!/bin/sh\necho called >> "${calls}"\nwhile [ "$1" != "-o" ]; do shift; done\ncp "${process.env.CURL_SOURCE ?? tgz}" "$2"\n`);
  chmodSync(join(bin, "curl"), 0o755);
  return { dir, work, cacheDir, bin, tgz, sha256, calls };
}
const onPath = (bin, fn) => {
  const real = process.env.PATH;
  process.env.PATH = `${bin}:${real}`;
  try { return fn(); } finally { process.env.PATH = real; }
};
const quiet = () => {};

test("a kept copy matching the pin is used, and nothing is downloaded", () => {
  const w = world();
  mkdirSync(w.cacheDir);
  writeFileSync(join(w.cacheDir, `gitleaks-${VERSION}.tgz`), readFileSync(w.tgz));
  onPath(w.bin, () => fetchSecretScanner({ version: VERSION, sha256: w.sha256, cacheDir: w.cacheDir, cwd: w.work, log: quiet }));
  assert.equal(readFileSync(join(w.work, "gitleaks"), "utf8"), "invented scanner\n");
  assert.equal(existsSync(w.calls), false, "the download ran although a good copy was kept");
});

test("with no kept copy it downloads, verifies, and keeps the archive for the next run", () => {
  const w = world();
  onPath(w.bin, () => fetchSecretScanner({ version: VERSION, sha256: w.sha256, cacheDir: w.cacheDir, cwd: w.work, log: quiet }));
  assert.equal(readFileSync(w.calls, "utf8"), "called\n");
  assert.equal(existsSync(join(w.work, "gitleaks")), true);
  assert.deepEqual(readFileSync(join(w.cacheDir, `gitleaks-${VERSION}.tgz`)), readFileSync(w.tgz));
});

test("a kept copy that does not match the pin is ignored", () => {
  const w = world();
  mkdirSync(w.cacheDir);
  writeFileSync(join(w.cacheDir, `gitleaks-${VERSION}.tgz`), "not the archive");
  onPath(w.bin, () => fetchSecretScanner({ version: VERSION, sha256: w.sha256, cacheDir: w.cacheDir, cwd: w.work, log: quiet }));
  assert.equal(readFileSync(w.calls, "utf8"), "called\n");
  assert.deepEqual(readFileSync(join(w.cacheDir, `gitleaks-${VERSION}.tgz`)), readFileSync(w.tgz), "the bad copy was not replaced");
});

test("a download that does not match the pin stops, and nothing is kept", () => {
  const w = world();
  assert.throws(() => onPath(w.bin, () => fetchSecretScanner({ version: VERSION, sha256: "0".repeat(64), cacheDir: w.cacheDir, cwd: w.work, log: quiet })), /does not match the pinned hash/);
  assert.equal(existsSync(join(w.cacheDir, `gitleaks-${VERSION}.tgz`)), false);
  assert.equal(existsSync(join(w.work, "gitleaks")), false);
});

test("both publish jobs and CI fetch the scanner this way, and the schedule keeps the copy alive", () => {
  const release = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  for (const [name, text] of [["release.yml", release], ["ci.yml", ci]]) {
    assert.doesNotMatch(text, /curl[^\n]*gitleaks\.tgz/, `${name} still downloads the scanner directly`);
    assert.match(text, /node scripts\/secret-scanner-fetch\.mjs/);
  }
  assert.equal(release.match(/- name: Restore the kept secret scanner/g).length, 2);
  const pending = release.slice(release.indexOf("\n  pending:\n"), release.indexOf("\n  entry:\n"));
  assert.match(pending, /actions\/cache@/, "nothing reads the copy between publishes, so it would be evicted");
  assert.match(pending, /continue-on-error: true/, "keeping the copy must never hold up the decision");
});
