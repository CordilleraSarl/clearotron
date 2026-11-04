// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// BEFORE THE FIRST START, DOCTOR SAYS WHAT START CREATES.
//
// Right after setup, before the first `clearotron start`, which the README places after doctor, doctor
// warned a newcomer twice (measured on a fresh install of a beta, 2026-11-04): the revocation list "cannot
// be read (ENOENT)", so "revoking anything would silently do nothing", and the configuration store "is not
// inside a git repository, so a save through the portal is refused". Both clear at the first start, which
// creates the list and makes the configuration directory a git repository.
//
// Neither was a fault. The key check reads the default list's absence as "nothing revoked", because every
// revocation creates the file it writes to (shared/scope.mjs, `isRevoked`). And the store is inside the
// directory `start` turns into a repository. So both lines now say what the first start creates.
//
// THE CONTROLS ARE THE CASES THAT ARE STILL FAULTS. A revocation list the settings NAME is checked
// fail-closed by the key check, so its absence still blocks. So does the default list gone missing after
// a start has run: start hands its door that path by name, so to the door it is a named list. A store
// outside the directory `start` initialises is never made a repository by it, so it still warns. And once
// the first start has run, the lines read the list and the repository it left.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handRunEnv } from "./drive-env.mjs";

const ONBOARD = fileURLToPath(new URL("../../bin/onboard.mjs", import.meta.url));

const NODE_BIN = (() => {
  const d = mkdtempSync(join(tmpdir(), "first-start-node-"));
  symlinkSync(process.execPath, join(d, "node"));
  return d;
})();

/** A home as setup leaves it with its defaults: data and configuration under ~/trademark, nothing started. */
function setUpHome({ store = "trademark/config/profiles", extra = "" } = {}) {
  const home = mkdtempSync(join(tmpdir(), "first-start-"));
  const base = join(home, "trademark");
  for (const d of ["pool", "workspace", "queue", "outbox", "locks", "config/skills"]) mkdirSync(join(base, d), { recursive: true });
  mkdirSync(join(home, store), { recursive: true });
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  writeFileSync(join(home, ".config", "clearotron", ".env"), [
    `CLEAROTRON_REPORTS_DIR=${join(base, "pool")}`,
    `CLEAROTRON_WORK_DIR=${join(base, "workspace")}`,
    `CLEAROTRON_QUEUE_DIR=${join(base, "queue")}`,
    `CLEAROTRON_CUSTOMERS_DIR=${join(home, store)}`,
    `PROFILE_REPO_ROOT=${join(home, store, "..")}`,
    extra,
  ].join("\n") + "\n");
  return home;
}

function doctor(home) {
  try {
    return execFileSync(process.execPath, [ONBOARD, "--check"], {
      encoding: "utf8", stdio: "pipe", timeout: 120_000,
      env: handRunEnv({ HOME: home, USERPROFILE: home, PATH: [NODE_BIN, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" }, {}),
    });
  } catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; }
}

const lineWith = (out, text) => out.split("\n").find((l) => l.includes(text));
const summary = (out) => out.split("This install cannot do everything yet:")[1] ?? "";

test("before the first start, the revocation list and the store are things start creates, not faults", () => {
  const home = setUpHome();
  try {
    const out = doctor(home);
    assert.doesNotMatch(out, /cannot be read \(ENOENT\)/, `an absent default revocation list is still reported as unreadable:\n${out}`);
    assert.doesNotMatch(out, /is not inside a git repository/, `the store start is about to initialise is still a warning:\n${out}`);
    const list = lineWith(out, "no revocation list yet");
    assert.ok(list, `doctor no longer says anything about the revocation list:\n${out}`);
    assert.match(list, /^ {2}· /, `a list nobody has created yet is reported above information:\n${list}`);
    assert.match(list, /no key has been revoked\. The first `[^`]*start` creates it\./, list);
    const store = lineWith(out, "recorded from the first");
    assert.ok(store, `doctor no longer says when saves to the store are recorded:\n${out}`);
    assert.match(store, /^ {2}· /, store);
    assert.match(store, /start`, which makes .*trademark\/config a git repository/, store);
    assert.doesNotMatch(summary(out), /revocation list|git repository/, "the summary still lists what the first start creates");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the control: a revocation list the settings name, and cannot be read, still blocks", () => {
  const home = setUpHome({ extra: "TRADEMARK_MCP_TOKEN_DENYLIST=/nonexistent/a-named-revocation-list" });
  try {
    const out = doctor(home);
    assert.match(out, /! the revocation list at \/nonexistent\/a-named-revocation-list cannot be read \(ENOENT\)/, out);
    assert.match(summary(out), /revocation list/, "a list the key check fails closed on dropped out of the summary");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the control: the default list missing after a start has run still blocks", () => {
  const home = setUpHome();
  try {
    // The grants file is what the first start writes; with it present, start has run.
    writeFileSync(join(home, "trademark", "grants.json"), "{}\n");
    const out = doctor(home);
    assert.match(out, /! the revocation list at .*token-denylist cannot be read \(ENOENT\)/, out);
    assert.doesNotMatch(out, /no revocation list yet/, "a list start's door reads by name was called not created yet");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the control: a store outside the directory start initialises still warns", () => {
  const home = setUpHome({ store: "elsewhere/profiles" });
  try {
    assert.match(doctor(home), /! .*elsewhere\/profiles is not inside a git repository, so a save through the portal is refused/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the control: after the first start, the list and the repository it left are read", () => {
  const home = setUpHome();
  try {
    writeFileSync(join(home, ".config", "clearotron", "token-denylist"), "# revoked key ids, one per line\n");
    const repo = join(home, "trademark", "config");
    execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
    const out = doctor(home);
    assert.match(out, /✓ revocation list readable at .*token-denylist — 0 revoked key id\(s\)/, out);
    assert.match(out, /saves to .*trademark\/config\/profiles are committed in/, out);
    assert.doesNotMatch(out, /no revocation list yet|recorded from the first/, "the before-start lines are printed after it");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
