#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// sync-e2e-store.mjs — fast-forward the E2E CONFIG STORE, and say which commit it landed on.
//
//   node scripts/sync-e2e-store.mjs [--check]
//
// Exit 0 clean · 1 if the checkout refused · 2 if it could not look.
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// The test instance deploys itself hourly from origin/main — that is the PRODUCT repo. The scenario
// definitions, the assertions `report` runs and every gold set live somewhere else, in CLEAROTRON_E2E_DIR,
// a plain checkout of the config repo. Nothing fast-forwarded it.
//
// It bit on 2026-08-05 and it read as a missing feature. A config PR added three assertion ops to a
// scenario and rewrote its gold set; the scenario ran twenty minutes later against a store three commits
// behind, and the report came back with the ops simply ABSENT — not failing, not reported as not-probed,
// just not there. 12 checks instead of 16. The run was also scored against the old gold set. Nothing
// failed and nothing warned. A reader comparing the report against the PR that added the ops would have
// concluded the ops had not been built.
//
// ── why THIS shape of failure and not the product one ────────────────────────────────────────────────
//
// An out-of-date PRODUCT checkout fails loudly: the deploy's own ancestor check refuses, and
// live-surface-check asserts every unit is on one commit. An out-of-date CONFIG checkout fails as an
// assertion that quietly does not exist, which is indistinguishable from an assertion nobody wrote.
// That is the whole reason this is a script and not a line in a runbook.
//
// ── it refuses rather than resolving ─────────────────────────────────────────────────────────────────
//
// --ff-only, and a dirty tree or a diverged branch is reported and left alone. This store decides what a
// round MEASURES: a merge commit or a stash invented by a timer at 04:00 would change what every
// scenario asserts, with nobody watching. A refusal is a message; a resolution is a silent edit.
//
// ── it runs as whoever owns the checkout ─────────────────────────────────────────────────────────────
//
// The checkout is owned by whoever cloned it, because that account holds the credential a fetch needs.
// Making the checkout writable to another user (a group, an ACL) still leaves fetch unable to
// authenticate. A typical layout is drwxrwx--- owned by the cloning account with the suite runner's
// group, and a .git/config readable only by the owner, so the runner can READ the working tree and
// cannot run git in it at all. So: if the invoker is not the owner and cannot write .git, elevate to the
// owner with passwordless sudo — their $HOME, their credential — and if that is not available, REFUSE
// and say so. A sync that cannot run must never look like a sync that found nothing to do.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";

const CHECK = process.argv.includes("--check");

// CLEAROTRON_E2E_DIR names the store's `e2e/` directory; the git checkout is its parent.
const e2eDir = (process.env.CLEAROTRON_E2E_DIR ?? "").trim();
if (!e2eDir) {
  console.log("sync-e2e-store: CLEAROTRON_E2E_DIR is unset — the bundled synthetic suite is in use and there is no external store to pull");
  process.exit(0);
}
const repo = dirname(e2eDir.replace(/\/+$/, ""));
// existsSync CANNOT TELL "absent" FROM "not allowed to look". A store is typically 770 owner:runner-group,
// so a user in neither gets EACCES on the traversal and existsSync answers false — and this
// script would then have reported "no git checkout here", which is a conclusion about the store derived
// from a failure to look. That is the same defect as the one being fixed, in the fix. Stat it and read
// the errno instead: ENOENT is an absence, EACCES is a refusal to look, and they exit differently.
try {
  statSync(join(repo, ".git"));
} catch (e) {
  if (e?.code === "ENOENT") {
    console.log(`sync-e2e-store: no git checkout at ${repo} (CLEAROTRON_E2E_DIR=${e2eDir}) — the store's version cannot be established`);
    process.exit(2);
  }
  console.log(`sync-e2e-store: cannot look at ${repo}/.git as uid ${process.getuid()} — ${e?.code ?? e}. This is a permission failure, NOT a finding about the store; run it as the checkout owner.`);
  process.exit(2);
}

// ── HOW IT DECIDES WHO RUNS GIT ─────────────────────────────────────────────────────────────────────
//
// TRY AS THE INVOKER FIRST, and elevate only if that actually fails.
//
// The first version of this file refused whenever the invoker was not the owner, on the reasoning that
// the owner holds the credential. That reasoning is about CREDENTIALS and it
// was applied here as a rule about OWNERSHIP, which is not the same thing — so the script refused before
// finding out whether it could have worked, and reported "no passwordless sudo to the owner" as the
// cause when that was true and was not the reason it could not pull.
//
// Measured on a real deployment, the two obstacles are narrower and neither is about privilege:
//   1. git's safe.directory check refuses a tree owned by someone else. That needs no elevation —
//      `-c safe.directory=<repo>` answers it, scoped to this invocation, writing no global config.
//   2. `.git/config` may not be READABLE by the invoker (660 owner-only inside a 770 owner:runner-group
//      tree), so git cannot find the remote at all. safe.directory does not touch
//      that, and a chgrp on one file fixes it.
// A third obstacle is real but is not this script's to solve: the invoker may hold no credential for a
// private remote. That surfaces as git's own auth error and is reported verbatim below.
const SAFE = ["-c", `safe.directory=${repo}`];
const tryHead = (run) => {
  try {
    execFileSync(run.length ? run[0] : "git", [...run.slice(1), ...(run.length ? ["git"] : []), ...SAFE, "-C", repo, "rev-parse", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return null;
  } catch (e) { return String(e?.stderr || e?.message || e).replace(/\s+/g, " ").trim().slice(0, 220); }
};
let RUN = [];
let ownerName = null;
try { ownerName = execFileSync("stat", ["-c", "%U", repo], { encoding: "utf8" }).trim(); } catch { /* named as unknown below */ }
const directErr = tryHead([]);
if (directErr) {
  // Only now is elevation worth trying, and only if it is actually available.
  if (ownerName) {
    try {
      execFileSync("sudo", ["-n", "-u", ownerName, "true"], { stdio: "ignore" });
      if (!tryHead(["sudo", "-n", "-u", ownerName])) RUN = ["sudo", "-n", "-u", ownerName];
    } catch { /* no elevation available */ }
  }
  if (!RUN.length) {
    console.log(`sync-e2e-store: cannot run git in ${repo} as uid ${process.getuid()} — REFUSING.`);
    console.log(`sync-e2e-store: git said: ${directErr}`);
    console.log(`sync-e2e-store: the store was NOT pulled, so a round starting now measures whatever was last pulled by hand. Owner is ${ownerName ?? "unknown"}.`);
    process.exit(1);
  }
}

const git = (...args) => {
  const [cmd, ...rest] = [...RUN, "git", ...SAFE, "-C", repo, ...args];
  return execFileSync(cmd, rest, { encoding: "utf8" }).trim();
};
const tryGit = (...args) => { try { return git(...args); } catch { return null; } };

const before = tryGit("rev-parse", "HEAD");
if (!before) { console.log(`sync-e2e-store: cannot read HEAD at ${repo}`); process.exit(2); }
const branch = tryGit("rev-parse", "--abbrev-ref", "HEAD");

if (branch !== "main") {
  console.log(`sync-e2e-store: on branch '${branch}', not main — REFUSING. HEAD stays ${before.slice(0, 8)}`);
  process.exit(1);
}
const dirty = tryGit("status", "--porcelain");
if (dirty) {
  console.log(`sync-e2e-store: working tree is dirty — REFUSING. HEAD stays ${before.slice(0, 8)}`);
  console.log(dirty.split("\n").map((l) => `    ${l}`).join("\n"));
  process.exit(1);
}
if (tryGit("fetch", "--quiet", "origin", "main") === null) {
  console.log(`sync-e2e-store: could not fetch origin — HEAD stays ${before.slice(0, 8)}`);
  process.exit(1);
}
if (CHECK) {
  const behind = tryGit("rev-list", "--count", "HEAD..origin/main");
  const ahead = tryGit("rev-list", "--count", "origin/main..HEAD");
  console.log(`sync-e2e-store: HEAD ${before.slice(0, 8)} — ${behind} behind, ${ahead} ahead of origin/main`);
  process.exit(ahead !== "0" ? 1 : 0);
}
if (tryGit("merge", "--ff-only", "--quiet", "origin/main") === null) {
  const ahead = tryGit("rev-list", "--count", "origin/main..HEAD");
  console.log(`sync-e2e-store: not a fast-forward (${ahead} local commit(s) origin does not have) — REFUSING. HEAD stays ${before.slice(0, 8)}`);
  process.exit(1);
}
const after = tryGit("rev-parse", "HEAD");
if (before === after) {
  console.log(`sync-e2e-store: already current at ${after.slice(0, 8)}`);
} else {
  console.log(`sync-e2e-store: ${before.slice(0, 8)} -> ${after.slice(0, 8)}`);
  console.log((tryGit("log", "--oneline", `${before}..${after}`) ?? "").split("\n").map((l) => `    ${l}`).join("\n"));
}
process.exit(0);
