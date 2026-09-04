// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// skills-store-provenance.mjs — CAN ANYBODY REPRODUCE THE DOCTRINE THIS RUN IS ABOUT TO BE RATED UNDER?
//
// ── THE FAILURE THIS CLOSES ─────────────────────────────────────────────────────────────────────────
//
// `CLEAROTRON_INSTRUCTIONS_DIR` points the engine at a deployment's doctrine store: the customer's risk framework,
// the synthesis rules, the delivery contract. Every stage reads that prose fresh from disk. If the
// checkout holding it is sitting on a feature branch, or has uncommitted edits under the store path, the
// run is rated under a document that exists on exactly one filesystem and matches no commit anywhere.
// The report reads normally. Nothing errors. The only thing wrong is which text it followed.
//
// That happened: on 2026-08-12 the live test store was found on a stale feature branch with uncommitted
// edits under `skills/`, a day old. The dirt happened to sit outside the overlay path in use, so no run
// read it — a fact about that one diff, not a property of the setup.
//
// `methodology-witness.mjs` already records the sha of every doctrine file each stage read, so the
// question is answerable AFTERWARDS. This module is the before: auditable-after does not stop a round's
// worth of spend landing on a draft tree.
//
// ── THREE OUTCOMES, NEVER TWO ───────────────────────────────────────────────────────────────────────
//
// Same shape and the same three words as the publication gate (`scripts/prepush-gate.mjs`): **pass**,
// **fail**, and **blocked** — could not run. A check that could not run is not a pass. "There is no git
// evidence here" and "this deployment does not use git for its store" produce identical silence from a
// naive check, and only one of them is safe.
//
// So the legal plain-directory deployment (a laptop, a CI archive, an unpacked tarball) is established
// AFFIRMATIVELY: walk from the store up to the filesystem root, and require that every step of that walk
// succeeded and found no `.git` entry. Any unreadable step on the way makes the answer `blocked`, never
// `plain-directory`. `git rev-parse` cannot make that distinction — it exits non-zero for "not a repo",
// for "git is not installed" and for "permission denied" alike, which is why the walk is hand-rolled and
// git is only asked the questions that presuppose a checkout.
//
// ── WHY THE DEFAULT WARNS ───────────────────────────────────────────────────────────────────────────
//
// Refusing by default would not be behaviour-neutral for a deployment already running. A preflight that
// never refuses cannot fail on any store state that exists, which is what makes this safe to land on a
// box nobody has looked at; a guard that turns a working box into a refusing box on upgrade is a guard
// that gets reverted. So hard mode is opt-in: set
// `CLEAROTRON_SKILLS_STORE_STRICT=1` and every non-pass outcome — including `blocked` — throws at the run
// door instead of printing. Unset, the same sentence is written to stderr and to the run's `run.jsonl`,
// where it sits next to the run it describes rather than in a journal nobody reads.

import { execFileSync } from "node:child_process";
import { statSync, lstatSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { envOn } from "./driver.config.mjs";

/** Opt-in hard mode: every non-pass outcome throws at the run door. Default off — see the docblock. */
export const STRICT_VAR = "CLEAROTRON_SKILLS_STORE_STRICT";
/** The branch name that counts as the main line. Default `main`; a store on `master` sets this. */
export const MAIN_BRANCH_VAR = "CLEAROTRON_SKILLS_STORE_MAIN_BRANCH";

// A guard that can hang is worse than the failure it prevents (the same reasoning drives the credential
// preflight's refusal to probe a live credential store). Every git call is bounded.
const GIT_TIMEOUT_MS = 10000;

const errText = (e) => String(e?.code || e?.message || e).replace(/\s+/g, " ").trim().slice(0, 200);
const firstLines = (s, n) => String(s ?? "").split("\n").filter(Boolean).slice(0, n);

/**
 * WHERE DOES THIS STORE LIVE — inside a checkout, or affirmatively outside every checkout?
 *
 * Returns `{ kind: "checkout", root, gitEntry, start }`, `{ kind: "plain", start }` or
 * `{ kind: "blocked", reason }`, where `start` is the store's real path — what the git pathspecs below
 * must use, since the checkout root was found by walking from it.
 *
 * `plain` is returned ONLY when the whole walk to the filesystem root completed with no unreadable step.
 * A stat or lstat that fails for any reason other than ENOENT ends the walk as `blocked` — an ancestor
 * this process cannot look inside might be holding the `.git` that would have changed the answer.
 *
 * `.git` is checked with lstat and accepted whether it is a directory or a FILE: a linked worktree and a
 * submodule both carry a `.git` file holding a gitdir pointer. The store this issue was raised from was
 * rescued on a linked worktree, so that case is live rather than theoretical. The pointer is followed by
 * git itself in the calls below, not here.
 *
 * The walk starts from the REAL path. A store reached through a symlink would otherwise have its
 * ancestors walked in the link's directory tree rather than the target's — looking for a checkout in the
 * wrong place and reporting "outside any checkout" about a directory that is inside one.
 */
export function findCheckoutRoot(dir, io = {}) {
  const stat = io.statSync || statSync;
  const lstat = io.lstatSync || lstatSync;
  const real = io.realpathSync || realpathSync;
  let cur, start;
  try { cur = start = real(resolve(String(dir))); }
  catch (e) { return { kind: "blocked", reason: `cannot resolve the store path ${dir} (${errText(e)})` }; }

  for (;;) {
    let st;
    try { st = stat(cur); }
    catch (e) { return { kind: "blocked", reason: `cannot read ${cur} (${errText(e)}) — an ancestor this process cannot see may hold the checkout` }; }
    if (!st.isDirectory()) return { kind: "blocked", reason: `${cur} is not a directory` };

    let entry = null;
    try { entry = lstat(join(cur, ".git")); }
    catch (e) {
      // ENOENT is the ONLY absence that means "no checkout here". EACCES, ELOOP and friends mean the
      // question was not answered, and an unanswered question is not a no.
      if (e?.code !== "ENOENT") return { kind: "blocked", reason: `cannot examine ${join(cur, ".git")} (${errText(e)})` };
    }
    if (entry) return { kind: "checkout", root: cur, gitEntry: entry.isDirectory() ? "directory" : "file", start };

    const parent = dirname(cur);
    if (parent === cur) return { kind: "plain", start };
    cur = parent;
  }
}

/**
 * Run one git command in `root`.
 *
 * `-c safe.directory=<root>`, scoped to this invocation and writing no config, because the driver runs
 * as a service account and the config store is routinely owned by somebody else — git refuses a tree
 * owned by another account, and every answer below would then degrade to `blocked` on a perfectly
 * healthy box. `scripts/sync-e2e-store.mjs` carries the same line and records that refusal measured on
 * the test box. Stripping it here still passed on the dev box, but only because that account's GLOBAL
 * git config already lists the store — which is exactly the kind of per-account state a deployed service
 * account will not have.
 * `--no-optional-locks` so a read-only check never tries to refresh the index of a store it does not own.
 *
 * Returns `{ status, out, error }`. `status` is the exit code when there was one and null when there was
 * not — a missing git binary and a timeout both land on null, and both are `blocked`, never a verdict.
 */
function gitRunner(exec = execFileSync) {
  return (root, args) => {
    try {
      const out = exec("git", ["-c", `safe.directory=${root}`, "--no-optional-locks", "-C", root, ...args],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: GIT_TIMEOUT_MS });
      return { status: 0, out: String(out ?? "").trim(), error: null };
    } catch (e) {
      return {
        status: typeof e?.status === "number" ? e.status : null,
        out: String(e?.stdout ?? "").trim(),
        error: errText(e?.stderr || e),
      };
    }
  };
}

const blocked = (base, reason) => ({ ...base, outcome: "blocked", findings: ["undetermined"], detail: [reason] });

/**
 * Classify the store `CLEAROTRON_INSTRUCTIONS_DIR` names.
 *
 * ```
 * { store, situation, outcome, findings, detail, repoRoot, gitEntry, branch, head, dirt }
 *   situation  no-overlay | plain-directory | checkout | unknown   where the store lives
 *   outcome    pass | fail | blocked                               the publication gate's three words
 *   findings   closed set: "dirty", "off-main" (both can appear), "undetermined"; empty on a pass
 * ```
 *
 * SCOPE, STATED: this classifies the OVERLAY only (`config.skillsOverlayDir`). The base tree
 * (`driver/skills`, inside the product checkout) is deliberately not classified — a dev box's product
 * checkout sits on a feature branch by design, so checking it would fire on every developer and on
 * nothing that matters. covers provenance on the render side of the base.
 */
export function classifySkillsStore(overlayDir, opts = {}) {
  const store = overlayDir ? resolve(String(overlayDir)) : null;
  const base = { store, situation: "unknown", outcome: "blocked", findings: [], detail: [],
    repoRoot: null, gitEntry: null, branch: null, head: null, dirt: [] };

  // NOT an absence read as a pass: an unset CLEAROTRON_INSTRUCTIONS_DIR is an affirmative statement that this
  // deployment serves doctrine from the tree that shipped with the driver, whose provenance is the
  // product checkout's own. There is no second store to be uncertain about.
  if (!store) return { ...base, situation: "no-overlay", outcome: "pass",
    detail: ["CLEAROTRON_INSTRUCTIONS_DIR is unset — doctrine comes from the driver's own skills tree, so there is no separate store to identify"] };

  const where = findCheckoutRoot(store, opts.io);
  if (where.kind === "blocked") return blocked(base, where.reason);
  if (where.kind === "plain")
    return { ...base, store: where.start, situation: "plain-directory", outcome: "pass",
      detail: [`${where.start} and every one of its ancestors up to the filesystem root were readable and none holds a .git entry — this store is affirmatively outside any checkout, which is a legal deployment (unpacked archive, image layer, laptop)`] };

  const root = where.root;
  const path = where.start;   // the REAL store path — what the checkout root was found by walking from
  const git = opts.git || gitRunner(opts.exec);
  const mainBranch = String(opts.mainBranch ?? "").trim() || "main";
  const at = { ...base, store: path, situation: "checkout", repoRoot: root, gitEntry: where.gitEntry };

  const head = git(root, ["rev-parse", "HEAD"]);
  if (head.status !== 0) return blocked(at, `${root} holds a .git entry but git cannot name its HEAD (${head.error || `exit ${head.status}`}) — the store's provenance is unknown, which is not the same as fine`);
  at.head = head.out;

  const branchRes = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branchRes.status !== 0) return blocked(at, `cannot read the branch of ${root} (${branchRes.error || `exit ${branchRes.status}`})`);
  at.branch = branchRes.out === "HEAD" ? null : branchRes.out;   // null ⇒ detached

  // IS THE STORE TRACKED BY THE CHECKOUT IT SITS IN? Asked before dirt, because `status` on a path the
  // repo ignores reports nothing and that emptiness would read as clean — the exact shape this guard
  // exists to refuse. An untracked store inside a checkout is not a verdict either way; it means the
  // dirt question cannot be answered here.
  const tracked = git(root, ["ls-files", "--", path]);
  if (tracked.status !== 0) return blocked(at, `cannot list tracked files under ${path} (${tracked.error || `exit ${tracked.status}`})`);
  if (!tracked.out)
    return blocked(at, `${path} sits inside the checkout at ${root} but that checkout tracks no file under it, so "no local modifications" would be a statement about nothing — this store's contents match no commit`);

  const onMainLine = (() => {
    if (at.branch === mainBranch) return { ok: true };
    // A detached HEAD, or a branch by another name, may still be a commit that is ON the main line — a
    // deployment pinned to a released sha is the normal case. Establish containment; do not infer it,
    // and do not collapse "cannot tell" into either answer.
    for (const ref of [`origin/${mainBranch}`, mainBranch]) {
      const verify = git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      if (verify.status !== 0 || !verify.out) continue;
      const anc = git(root, ["merge-base", "--is-ancestor", "HEAD", ref]);
      if (anc.status === 0) return { ok: true, via: ref };
      if (anc.status === 1) return { ok: false, via: ref };
      return { undetermined: `cannot tell whether HEAD is contained in ${ref} (${anc.error || `exit ${anc.status}`})` };
    }
    return { undetermined: `neither origin/${mainBranch} nor ${mainBranch} resolves in ${root}, so there is nothing to measure "on the main line" against` };
  })();
  if (onMainLine.undetermined) return blocked(at, onMainLine.undetermined);

  // Dirt is asked of the OVERLAY PATH, not the whole repo: yesterday's edits missing the served subtree
  // was a fact about that diff, and a guard scoped to the whole checkout would refuse runs over an edit
  // to a README. Untracked files COUNT — `driver/stray-artifacts.mjs` exists because files appeared
  // inside the doctrine tree that no commit knows about, and `--untracked-files=no` would hide exactly
  // those.
  const status = git(root, ["status", "--porcelain", "--untracked-files=all", "--", path]);
  if (status.status !== 0) return blocked(at, `cannot read the working-tree status of ${path} (${status.error || `exit ${status.status}`})`);
  at.dirt = firstLines(status.out, 20);

  const findings = [];
  const detail = [];
  if (at.dirt.length) {
    findings.push("dirty");
    detail.push(`${at.dirt.length}${at.dirt.length === 20 ? "+" : ""} uncommitted change(s) under ${path}: ${at.dirt.join("; ")}`);
  }
  if (!onMainLine.ok) {
    findings.push("off-main");
    detail.push(`HEAD (${at.head.slice(0, 8)}${at.branch ? ` on ${at.branch}` : ", detached"}) is not contained in ${onMainLine.via} — this doctrine is a branch's, not the main line's`);
  }
  if (!findings.length)
    detail.push(`${at.branch ? `on ${at.branch}` : "detached"} at ${at.head.slice(0, 8)}, no local modifications under ${path}`);

  return { ...at, outcome: findings.length ? "fail" : "pass", findings, detail };
}

/** One line for a log or a refusal. Names the store, what is wrong with it, and what to do about it. */
export function describeSkillsStore(result) {
  const head = {
    pass: "doctrine store identified",
    fail: "doctrine store cannot be reproduced",
    blocked: "doctrine store COULD NOT BE IDENTIFIED",
  }[result?.outcome] || "doctrine store COULD NOT BE IDENTIFIED";
  const parts = [`${head}: ${result?.store ?? "(CLEAROTRON_INSTRUCTIONS_DIR unset)"}`];
  if (result?.detail?.length) parts.push(result.detail.join(" | "));
  if (result?.outcome === "fail")
    parts.push(`commit or stash the edits, or check the store out on its main line — a run rated under this tree cannot be reproduced from any commit. ${STRICT_VAR}=1 makes this a refusal instead of a warning.`);
  if (result?.outcome === "blocked")
    parts.push(`could-not-determine is not a pass. Name the store's state before spending a run on it. ${STRICT_VAR}=1 makes this a refusal instead of a warning.`);
  return parts.join(" — ");
}

/**
 * The run-door preflight. Shaped like `preflightFreeSpace`: returns `{ result, warning }` and throws
 * ONLY in hard mode, so an existing deployment behaves exactly as it did before this landed.
 *
 * Called from `pipelineInner` beside the binary, disk and credential preflights — once per run, before
 * any spend. Deliberately NOT inside `config.resolveSkillPath`: that runs per file per stage and the
 * gateway re-derives the resolver on every dispatch, so a git call there would run hundreds of times
 * mid-run to re-answer a question about the door.
 *
 * OUT OF HARD MODE THIS FUNCTION CANNOT THROW, and that is a property rather than an argument: the
 * classifier is caught whole, and a defect inside it lands on `blocked` like any other unanswered
 * question. Without that, a bug in a guard nobody asked for could kill runs on a deployment that never
 * armed it — and prod-neutrality would rest on having read the code carefully, which is not a guarantee.
 */
export function preflightSkillsStore(env = process.env, opts = {}) {
  let result, line;
  try {
    result = classifySkillsStore(env?.CLEAROTRON_INSTRUCTIONS_DIR || null, { mainBranch: env?.[MAIN_BRANCH_VAR], ...opts });
    line = describeSkillsStore(result);
  } catch (e) {
    // Every throwing path lands here, the sentence included — an exception while DESCRIBING a store is
    // as fatal to a run as one while classifying it, and would be the more embarrassing of the two.
    result = { store: null, situation: "unknown", outcome: "blocked", findings: ["undetermined"],
      detail: [`the store check itself failed (${errText(e)}) — the store's state is unknown, which is not the same as fine`],
      repoRoot: null, gitEntry: null, branch: null, head: null, dirt: [] };
    line = describeSkillsStore(result);   // built here, from strings only
  }
  if (result.outcome === "pass") return { result, warning: null, line };
  // A strict flag that cannot be read is not armed. The one direction this may not fail is toward a
  // refusal on a deployment that never asked for one.
  let strict = false;
  try { strict = envOn(STRICT_VAR, env); } catch { strict = false; }
  if (strict) throw new Error(`[preflight] ${line}`);
  return { result, warning: `[preflight] ${line}`, line };
}
