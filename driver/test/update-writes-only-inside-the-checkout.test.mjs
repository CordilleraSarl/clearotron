// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — `clearotron update`, and the promise that makes it safe to type.
//
// THE REFUSAL IS THE VALUABLE HALF, so it is what is asserted here. `git pull` already worked; what
// did not exist was anything that stops an upgrade landing on a user's own doctrine and customer files.
//
// EVERY BEHAVIOURAL ARM RUNS AGAINST STUBBED `git` AND `npm`, on a PATH this file builds. That is not
// tidiness: if the refusal ever fails to fire, the arm that proves it would otherwise run a REAL
// `git pull --ff-only` and a REAL `npm ci` inside this checkout. A test whose failure mode is mutating
// the tree it is testing cannot be allowed to exist, so the damage is made impossible rather than
// unlikely — and the stub log is also the instrument, because "nothing ran" needs a recorder that can
// show something running.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { pinEnvAll } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const UPDATE = join(ROOT, "bin", "update.mjs");

// ── the write surface, read straight off the file ──────────────────────────────────────────────────

// Every fs call that CREATES or CHANGES something. `existsSync` and the read family are absent on
// purpose: this list is what the verb must not contain, not what it must not import.
const WRITE_CALLS = [
  "writeFileSync", "appendFileSync", "mkdirSync", "copyFileSync", "renameSync", "unlinkSync",
  "rmSync", "rmdirSync", "chmodSync", "chownSync", "symlinkSync", "linkSync", "truncateSync",
  "createWriteStream", "writeFile", "appendFile", "mkdir", "copyFile", "rename", "unlink", "rm",
  "cpSync", "writeSync", "ftruncateSync",
];

// `openSync` is deliberately NOT in the list above: it is a READ api too, and forbidding it outright
// would red an arm whose message says this verb writes outside the checkout the day someone reads a file
// by descriptor — a false positive whose text sends the reader in the wrong direction. Only its write
// modes are a write, so only those are matched.
const OPEN_FOR_WRITING = /openSync\s*\([^)]*,\s*["'`][^"'`]*[wa+]/;

test("#1784 update has NO code path that writes outside the checkout — it holds no write call at all", () => {
  const src = readFileSync(UPDATE, "utf8");
  // Comments describe the promise in the same words the code keeps, so they would mask a real call.
  const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const found = WRITE_CALLS.filter((c) => new RegExp(`\\b${c}\\s*\\(`).test(code));
  if (OPEN_FOR_WRITING.test(code)) found.push("openSync (in a write mode)");
  assert.deepEqual(found, [],
    `bin/update.mjs calls ${found.join(", ")}. This verb's only permitted action toward a user's `
    + "configuration is to refuse and explain — moving their files is a decision with their data in it, "
    + "and a convenience added here is exactly how that promise gets broken quietly.");
});

test("#1784 every command update runs is run IN the checkout — a bare spawn would inherit the caller's cwd", () => {
  const src = readFileSync(UPDATE, "utf8");
  const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const spawns = [...code.matchAll(/spawnSync?\s*\(/g)];
  assert.ok(spawns.length >= 1, "no spawn at all in update.mjs — this arm is asserting nothing");
  // One helper owns every spawn, and it pins cwd. Asserting the helper rather than each call site is
  // the point: a second spawn added later must go through it or this goes red.
  assert.equal(spawns.length, 1,
    `${spawns.length} spawn sites in update.mjs. One helper (runInCheckout) must own them all, or a `
    + "later addition inherits whatever directory the user happened to be standing in.");
  assert.match(code, /spawnSync\([^)]*\{[^}]*cwd:\s*REPO/s,
    "the spawn helper does not pin cwd to REPO — `clearotron update` run from inside a customer's own "
    + "configuration directory would then git-pull THAT directory.");
});

// ── the behaviour, against stubs ───────────────────────────────────────────────────────────────────

/** A PATH directory holding `git` and `npm` that record their arguments and succeed. */
function stubPath(dir) {
  const log = join(dir, "ran.log");
  for (const name of ["git", "npm"]) {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\necho "${name} $@" >> ${JSON.stringify(log)}\nexit 0\n`);
    chmodSync(p, 0o755);
  }
  return log;
}

function runUpdate({ config = {}, path, argv = [] }) {
  const env = { ...process.env, PATH: `${path}:${process.env.PATH}` };
  // pinEnvAll writes EVERY spelling, so no alias of these names can answer from somewhere else and
  // decide the arm — including a .env this checkout may or may not have.
  // QUOTED keys, deliberately. pinEnvAll already writes every spelling, so the behaviour is right
  // either way — but 's sweep finds a site by the variable's LITERAL name appearing beside a
  // helper call, and a bare object key is invisible to it. Quoting is what makes the coverage legible.
  pinEnvAll(env, {
    "CLEAROTRON_CUSTOMERS_DIR": config.profiles ?? "",
    "CLEAROTRON_INSTRUCTIONS_DIR": config.skills ?? "",
    "PROFILE_REPO_ROOT": config.repoRoot ?? "",
  });
  for (const [k, v] of Object.entries(env)) if (v === "") delete env[k];
  const r = spawnSync(process.execPath, [UPDATE, ...argv], { env, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

test("#1784 configuration INSIDE the checkout is refused, and nothing is run", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "upd-refuse-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = stubPath(dir);

  const inside = join(ROOT, "driver", "skills");
  assert.ok(existsSync(inside), "fixture precondition: a real directory inside the checkout to point at");

  const r = runUpdate({ config: { skills: inside }, path: dir });
  assert.equal(r.code, 3, `expected the refusal exit code, got ${r.code}. Output:\n${r.out}`);
  assert.match(r.out, /UPDATE REFUSED/, "the refusal is not announced as one");
  // THE NAME THE READER CAN ACT ON. This arm used to assert two things — that the refusal names the
  // current spelling AND that it never names the retired one — because the fixture pinned both and the
  // refusal had to choose. closed that window: there is one spelling, so the second assertion
  // became a copy of the first negated, and a test cannot pass both. What is left is the half that was
  // ever about the reader: the refusal names the variable they set.
  assert.match(r.out, new RegExp("CLEAROTRON_INSTRUCTIONS_DIR"),
    "the refusal does not name the variable at fault, in the spelling the reader actually set");
  assert.ok(/file\(s\) an upgrade would land on top of/.test(r.out),
    `the refusal does not name the files it would have clobbered, which is half of what #1784 asks for:\n${r.out}`);
  assert.equal(existsSync(log), false,
    `git or npm RAN despite the refusal — ${existsSync(log) ? readFileSync(log, "utf8") : ""}. The check `
    + "must come before anything is touched, or the damage is done by the time it is described.");
});

test("#1784 THE CONTROL: with configuration outside the checkout the stubs DO record — so the empty log above means something", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "upd-ok-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = stubPath(dir);
  const outside = join(dir, "config", "skills");
  mkdirSync(outside, { recursive: true });

  const r = runUpdate({ config: { skills: outside }, path: dir });
  assert.equal(existsSync(log), true,
    "neither stub ran on the happy path either, so the refusal arm's 'nothing ran' proves nothing — "
    + "a zero is only evidence when the instrument can show non-zero.");
  const ran = readFileSync(log, "utf8");
  assert.match(ran, /git pull --ff-only/, `git was not run as --ff-only:\n${ran}`);
  assert.match(ran, /npm ci/, `dependencies were not reinstalled after the pull:\n${ran}`);
  assert.ok(ran.indexOf("git pull") < ran.indexOf("npm ci"),
    `npm ci ran before the pull, so it installed the OLD dependency set:\n${ran}`);
  assert.equal(r.code, 0, `expected success, got ${r.code}. Output:\n${r.out}`);
});

// ── — ASKING WHAT THE COMMAND DOES MUST NOT DO IT ───────────────────────────────────────────
//
// This file parsed no arguments, so node handed `--help` straight through and the verb ran: measured
// 2026-08-25, `clearotron update --help` executed `git pull --ff-only` and `npm ci` and moved HEAD.
// The arms below run on configuration OUTSIDE the checkout deliberately — that is the path where the
// verb PROCEEDS, so it is the only path where a swallowed flag can do damage. On the refusal path
// nothing runs anyway and the arm would pass without testing anything.
//
// The control above is what makes an empty stub log mean something here: it proves both stubs record
// on this same path when the verb is allowed to act.
test("#1861 --help prints and performs NOTHING, on the path where the verb would otherwise act", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "upd-help-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = stubPath(dir);
  const outside = join(dir, "config", "skills");
  mkdirSync(outside, { recursive: true });

  for (const flag of ["--help", "-h"]) {
    const r = runUpdate({ config: { skills: outside }, path: dir, argv: [flag] });
    assert.equal(r.code, 0, `${flag} did not exit 0: ${r.code}\n${r.out}`);
    assert.match(r.out, /npx clearotron update/, `${flag} printed no usage:\n${r.out}`);
    assert.doesNotMatch(r.out, /Updating the product/,
      `${flag} entered the update path — asking what the command does performed it:\n${r.out}`);
    assert.equal(existsSync(log), false,
      `${flag} RAN something: ${existsSync(log) ? readFileSync(log, "utf8") : ""}`);
  }
});

test("#1861 an unrecognised argument is REFUSED, not swallowed — fixing only --help would leave the class", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "upd-unknown-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = stubPath(dir);
  const outside = join(dir, "config", "skills");
  mkdirSync(outside, { recursive: true });

  // --dry-run is the one a careful operator invents when they want to see what would happen. Swallowed,
  // it did the opposite of what they asked for.
  const r = runUpdate({ config: { skills: outside }, path: dir, argv: ["--dry-run"] });
  assert.equal(r.code, 2, `an unknown flag did not refuse: exit ${r.code}\n${r.out}`);
  assert.match(r.out, /unrecognised argument/, `the refusal does not say what was wrong:\n${r.out}`);
  assert.match(r.out, /--dry-run/, `the refusal does not name the argument the operator typed:\n${r.out}`);
  assert.equal(existsSync(log), false,
    `an unknown flag RAN something: ${existsSync(log) ? readFileSync(log, "utf8") : ""}`);
});

test("#1784 a sibling named after the checkout is NOT inside it — the separator is the whole rule", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "upd-sib-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = stubPath(dir);

  // `<repo>-notes` genuinely starts with `<repo>` as a STRING. Refusing it would tell a user to move a
  // directory that was never in the wrong place — the exact false positive exists to prevent.
  const sibling = `${ROOT}-notes`;
  const r = runUpdate({ config: { skills: sibling }, path: dir });
  assert.notEqual(r.code, 3,
    `a sibling directory named after the checkout was refused as being inside it:\n${r.out}`);
  assert.equal(existsSync(log), true, "the run stopped before doing anything, for some other reason");
});

test("#1784 an ABSENT directory inside the checkout is still refused — it is the same defect one mkdir later", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "upd-absent-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = stubPath(dir);

  const ghost = join(ROOT, "no-such-config-dir-1784");
  assert.equal(existsSync(ghost), false, "fixture precondition: the path must not exist");

  const r = runUpdate({ config: { profiles: ghost }, path: dir });
  assert.equal(r.code, 3, `an absent path inside the checkout was allowed through:\n${r.out}`);
  assert.match(r.out, /does not exist yet/,
    "the refusal does not say why an absent directory is still a refusal, so it reads as a bug");
  assert.equal(existsSync(log), false, "git or npm ran despite the refusal");
});
