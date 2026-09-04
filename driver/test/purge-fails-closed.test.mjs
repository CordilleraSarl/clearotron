// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a deletion tool has no defaults.
//
// `scripts/purge-runs.mjs` resolved its two roots as
//
//     CLEAROTRON_REPORTS_DIR      || "/srv/trademark-archive"        ← the PRODUCTION client archive
//     CLEAROTRON_WORK_DIR || <a hardcoded operator workspace>   ← the PRODUCTION workspace
//
// reached by an operator forgetting to export a variable, in the one script in this repo that removes
// bytes. The driver has since taken the same answer for the pool — `config.poolRoot` in
// driver/driver.config.mjs throws when CLEAROTRON_REPORTS_DIR is unset rather than defaulting — but a
// deletion tool that inherits its safety from a library it does not import has no safety at all, so
// this script states its own refusal.
//
// AND `--apply` IS NOT THE GUARD IT LOOKS LIKE. Dry-run is the default, so the workflow is: run it, read
// the table, add `--apply`. Nothing on that screen named the archive — so a dry run read on one root and
// an apply executed on another were indistinguishable to the operator. The failure is silent in the
// direction that matters: a wrong path that does not exist errors loudly and harmlessly; a wrong path
// that IS full of real client runs does exactly what it was asked, with no undo.
//
// These tests SPAWN the script rather than importing it. `main` is invoked at module scope (the
// shape), so an import would execute the tool — and they should exercise the operator's real entry point
// anyway, which is the process, not the function.
//
// Run:  node --test driver/test/purge-fails-closed.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "scripts", "purge-runs.mjs");

/** Run the tool with a fully controlled environment. `env` REPLACES the two roots rather than adding. */
// ── — EVERY SPELLING, DERIVED. THE GUARD'S SCRUB WAS AS NARROW AS ITS AUTHOR'S MEMORY ────────
//
// This helper deleted two hardcoded names. That was sufficient while `purge-runs.mjs` did not translate:
// the new spellings reached nothing, so removing the old ones removed the value. Since the script
// imports the alias loader, BOTH spellings resolve — and a box (or a test runner) with
// `CLEAROTRON_REPORTS_DIR` set would sail past a scrub that only removed `CLEAROTRON_REPORTS_DIR`. Measured
// before this was written: with the new spelling set and the old one absent, the tool resolved its roots
// and entered SWEEP mode, exit 0. This is the fail-closed guard on a DELETE tool, so a scrub it can
// defeat is the whole guard.
//
// Derived via `spellingsOf`, never listed, for the reason the list above failed: the next rename must not
// need anyone to remember this file.
const ROOTS = ["CLEAROTRON_REPORTS_DIR", "CLEAROTRON_WORK_DIR"];
const [POOL_NAME, WORKSPACE_NAME] = ROOTS.map((n) => n);

function purge(args, { pool, workspace } = {}) {
  const env = { ...process.env };
  for (const n of ROOTS) for (const spelling of [n]) delete env[spelling];
  // Set EVERY spelling too, not just one: a value written under the retired name loses to a stale new
  // name inherited from the parent, because translation resolves a disagreement in favour of the current
  // spelling by design.
  if (pool) for (const spelling of ["CLEAROTRON_REPORTS_DIR"]) env[spelling] = pool;
  if (workspace) for (const spelling of ["CLEAROTRON_WORK_DIR"]) env[spelling] = workspace;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** A minimal, empty estate — enough for the tool to resolve and report zero runs. */
function estate(t) {
  const dir = mkdtempSync(join(tmpdir(), "purge-559-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "pool"), { recursive: true });
  mkdirSync(join(dir, "ws", "workspace-test", "studio", "prelim-search"), { recursive: true });
  return { dir, pool: join(dir, "pool"), workspace: join(dir, "ws") };
}

// ── No defaults ────────────────────────────────────────────────────────────────────────────────────

test("#559 an unset CLEAROTRON_REPORTS_DIR REFUSES and names the variable — it never resolves to production", (t) => {
  const e = estate(t);
  const r = purge(["--keep-none"], { workspace: e.workspace });   // pool deliberately absent
  assert.equal(r.code, 2, "a deletion tool with no target must exit non-zero, not proceed on a guess");
  // The name the refusal prints is the one an OPERATOR should set, derived — not the one the code reads.
  // Those diverged at the rename, and this message named the retired spelling, so following it meant
  // adding a deprecated variable to fix a script that had just refused to run.
  assert.match(r.err, new RegExp(`${POOL_NAME} is not set, and this script DELETES`));
  assert.match(r.err, /no default/i);
  assert.doesNotMatch(r.out + r.err, /\/srv\/trademark-archive/,
    "the production archive path must not even be MENTIONED as a fallback — naming it invites re-adding it");
});

test("#559 an unset CLEAROTRON_WORK_DIR refuses too — two of the three stores derive from it", (t) => {
  const e = estate(t);
  const r = purge(["--keep-none"], { pool: e.pool });   // workspace deliberately absent
  assert.equal(r.code, 2);
  assert.match(r.err, new RegExp(`${WORKSPACE_NAME} is not set`));
  assert.doesNotMatch(r.out + r.err, /azureuser/,
    "the production workspace default is gone; fixing only the pool would fail closed on one third of the blast radius");
});

test("#1532 the scrub removes EVERY spelling — a new-spelling root in the parent cannot leak in", (t) => {
  // THE POSITIVE CONTROL FOR THE SCRUB, and the reason it exists. Measured on this tree: with only
  // `CLEAROTRON_REPORTS_DIR` set and `CLEAROTRON_REPORTS_DIR` absent, purge-runs resolved its roots and entered
  // SWEEP mode at exit 0. A helper that deleted the retired name alone would have handed every arm above
  // an inherited target and they would all have passed while proving nothing.
  //
  // Driven through the SAME helper the arms use, with the new spelling planted on the way in — testing a
  // reimplementation here would leave the helper itself unchecked, which is the shape being fixed.
  const e = estate(t);
  const planted = { ...process.env };
  for (const n of ROOTS) for (const sp of [n]) delete planted[sp];
  planted[POOL_NAME] = e.pool;
  planted[WORKSPACE_NAME] = e.workspace;
  const saved = process.env;
  try {
    process.env = planted;                       // the helper reads process.env to build the child's
    const r = purge(["--keep-none"]);            // no roots passed — every spelling must have been scrubbed
    assert.equal(r.code, 2, `an inherited ${POOL_NAME} survived the scrub and gave the delete tool a target`);
    assert.match(r.err, new RegExp(`${POOL_NAME} is not set`));
  } finally { process.env = saved; }
});

test("#559 the source carries no production fallback at all", () => {
  const src = readFileSync(SCRIPT, "utf8");
  // Anchored on the `||` fallback form, not on the bare strings — the doc block above deliberately
  // quotes the old defaults so the next reader knows what was removed and why.
  assert.doesNotMatch(src, /CLEAROTRON_REPORTS_DIR\s*\|\|/, "no `||` fallback on the pool root");
  assert.doesNotMatch(src, /CLEAROTRON_WORK_DIR\s*\|\|/, "no `||` fallback on the workspace root");
});

// ── The target is on screen, and must be restated to delete ────────────────────────────────────────

test("#559 every invocation prints the roots it resolved, dry run included", (t) => {
  const e = estate(t);
  const r = purge(["--keep-none"], e);
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp(`-- pool:\\s+${e.pool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    "a guard the operator cannot see is a guard they cannot confirm");
  assert.match(r.out, /-- workspace:\s+\S/);
  // And the dry run hands back the exact apply command, root included, so the operator copies rather
  // than retypes — the step where a wrong estate would otherwise be introduced.
  assert.match(r.out, /--apply --expect=0 --expect-root=/);
});

test("#559 --apply without --expect-root refuses, and says what this run resolved", (t) => {
  const e = estate(t);
  const r = purge(["--keep-none", "--apply", "--expect=0"], e);
  assert.equal(r.code, 2);
  assert.match(r.err, /--apply requires --expect-root=/);
  assert.match(r.err, /This run resolved/);
});

test("#559 a dry run on one estate cannot authorise an apply on another", (t) => {
  const e = estate(t);
  const other = estate(t);
  const r = purge(["--keep-none", "--apply", "--expect=0", `--expect-root=${other.pool}`], e);
  assert.equal(r.code, 2);
  assert.match(r.err, /ROOT MISMATCH/);
  assert.match(r.err, /Nothing removed/);
  assert.ok(existsSync(e.pool) && existsSync(other.pool), "neither estate is touched by a refused apply");
});

test("#559 a matching root proceeds — the guard blocks the wrong target, not the tool", (t) => {
  const e = estate(t);
  const r = purge(["--keep-none", "--apply", "--expect=0", `--expect-root=${e.pool}`], e);
  assert.equal(r.code, 0, "the correct target must still work, or operators will route around the guard");
  assert.match(r.out, /Removed 0 run directories/);
});

test("#559 a trailing slash is not a mismatch — the guard must not fire on cosmetics", (t) => {
  const e = estate(t);
  const r = purge(["--keep-none", "--apply", "--expect=0", `--expect-root=${e.pool}/`], e);
  assert.equal(r.code, 0, "a guard that cries wolf on a trailing slash teaches operators to bypass it");
});

// ── The root guard runs BEFORE anything is removed ─────────────────────────────────────────────────

test("#559 the root mismatch is checked before any deletion, not after the first one", (t) => {
  const e = estate(t);
  // A pool entry the sweep would classify as a deletable run, so `del` is non-empty and any ordering
  // bug that deletes first and validates second would leave evidence.
  const victim = join(e.pool, "cli-purge559-victim");
  mkdirSync(victim, { recursive: true });
  writeFileSync(join(victim, "report.html"), "<html>evidence</html>");
  const dry = purge(["--keep-none"], e);
  assert.equal(dry.code, 0);
  const r = purge(["--keep-none", "--apply", "--expect=1", "--expect-root=/srv/trademark-archive"], e);
  assert.equal(r.code, 2, "the mismatch must refuse");
  assert.ok(existsSync(victim), "and it must refuse BEFORE removing anything — the run is still on disk");
});

// ── — THE TEARDOWN'S PURGE PASSED NO --expect-root, SO IT WAS REFUSED ON EVERY WORKING RUN ──────
//
// `--apply` has required `--expect-root=` since. `scripts/e2e.mjs` never passed one, so every
// purge it attempted exited 2 — on every run that reached publish, which is every run that WORKED. The
// teardown reported "purge REFUSED" honestly and the pool was never cleaned, which is why this read as
// a tidiness problem rather than a broken call.
//
// SOURCE-ANCHORED, like the harness's siblings: the apply is inside a teardown that walks a live pool,
// and what is under test is which flags the call carries and where the value comes from.
test("#641 the teardown reads the root off the dry run it ran, and refuses to apply without one", () => {
  const src = readFileSync(new URL("../../scripts/e2e.mjs", import.meta.url), "utf8");
  const i = src.indexOf('"--apply"');
  assert.ok(i > 0, "the apply call must exist — if it moved, re-anchor rather than delete");
  const call = src.slice(i - 400, i + 300);
  assert.match(call, /--expect-root=\$\{expectRoot\}/, "the apply passes the root; without it purge-runs exits 2");
  assert.match(call, /--expect=\$\{expect\}/, "…and the count, as before");

  // WHERE THE VALUE COMES FROM IS THE WHOLE POINT. `CLEAROTRON_REPORTS_DIR` read here would satisfy the flag
  // and defeat the guard — 's rule is that a dry run on one estate cannot authorise an apply on
  // another, and a root this process asserts about itself proves nothing about the run reviewed.
  const derive = src.slice(src.indexOf("let expectRoot"), i);
  assert.match(derive, /dry\.match\(/, "the root is PARSED OUT of the dry run's own output");
  assert.ok(!/expectRoot\s*=\s*POOL_ROOT|expectRoot\s*=\s*process\.env/.test(src),
    "the root is never asserted by this process — that would make the guard decoration");
  // an absence is a finding: no root printed ⇒ no apply
  assert.match(src, /purge dry-run printed no --expect-root — not applying/,
    "a dry run whose shape we do not recognise must refuse, never fall back to a guess");

  // …and purge-runs really does print the flag in the form parsed here — one grammar, two readers.
  const purge = readFileSync(new URL("../../scripts/purge-runs.mjs", import.meta.url), "utf8");
  assert.match(purge, /--expect-root=\$\{POOL_ROOT\}/, "the dry run names the root it resolved");
  const printed = "Re-run with --apply --expect=3 --expect-root=/srv/pool to delete.";
  assert.equal((printed.match(/--expect-root=(\S+)/) ?? [])[1], "/srv/pool",
    "the parse in e2e.mjs recovers the root from that exact line");
});
