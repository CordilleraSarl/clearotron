// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// store-in-repo.mjs — can a git commit rooted HERE ever stage a file written THERE?
//
//. A config store save is two steps that are not atomic: write the file, then `git add` it into the
// store's repository. When the second step is rooted at a repository that does not contain the first
// step's path, git refuses with `fatal: … is outside repository` — AFTER the write has landed. The save
// reports written:true (correctly — the file IS live), the audit row records `commit: null`, and the
// orphan sits untracked forever. Nothing retries it, and the next store sync refuses on the dirty tree:
//
//   sync-e2e-store: working tree is dirty — REFUSING. HEAD stays 36715977
//
// Measured on the test box 2026-08-20: one save at 11:41Z blocked every hourly deploy tick until a human
// removed the file at 07:10Z the next day — 19 hours in which the doctrine store could not advance, and
// the only symptom was a line in a deploy log nobody reads.
//
// THE POINT IS THAT THIS IS DECIDABLE BEFORE ANY SAVE. The two directories are known at boot. If the
// store is not inside the repository, EVERY commit will fail, so the deployment can be told at start-up
// instead of discovering it hours later through an unrelated-looking refusal.
//
// ── WHY THIS IS A MODULE AND NOT A LINE ──────────────────────────────────────────────────────────────
//
// The rule was already written down twice — recipe-service.mjs refused to start on it, bin/start.mjs
// warned on it — and both copies covered RECIPES. The profile side, which is where the incident actually
// happened, had neither. That is this codebase's most expensive recurring shape: a control that is
// correct, and a second place that had to carry it and did not. One statement, four callers.
//
// ── WHICH WAY IT FAILS, AND WHY ──────────────────────────────────────────────────────────────────────
//
// Callers turn a `false` here into a refusal — a fatal exit, or a settings surface that answers 404. A
// wrong `false` is therefore an OUTAGE, while a wrong `true` is the status quo this defect already
// describes. So a path is outside only when BOTH the lexical reading and the symlink-resolved one say so:
// `resolve()` alone is lexical, and these stores are routinely reached through symlinked paths
// (`/opt/cordillera/...`), where a store genuinely inside the repository resolves to a string that does
// not look like it.
//
// A path that cannot be read falls back to its own lexical form, NOT to "contained". A store directory
// that does not exist yet is still misconfigured if it names another tree — the service would create it
// and then fail every commit — so the lexical judgment stands where the filesystem cannot overturn it.

import { resolve, dirname } from "node:path";
import { realpathSync } from "node:fs";

/** `resolve`, then the symlink-resolved form when the path exists — null when it cannot be read. */
const real = (p) => { try { return realpathSync(resolve(p)); } catch { return null; } };

const within = (dir, root) => dir === root || dir.startsWith(root.endsWith("/") ? root : root + "/");

/**
 * Is `storeDir` somewhere `git -C repoRoot add` could stage it?
 *
 * @param {string} storeDir  the directory the service WRITES into
 * @param {string} repoRoot  the directory the service COMMITS from
 * @returns {{ ok: boolean, store: string, repo: string }}
 *   `ok:false` only when both the lexical and the symlink-resolved reading agree the store is outside.
 *   `store`/`repo` are the resolved paths, for the message — a caller printing the raw env values would
 *   print two relative-looking strings that do not obviously fail to contain one another.
 */
export function storeInRepo(storeDir, repoRoot) {
  const store = resolve(String(storeDir ?? ""));
  const repo = resolve(String(repoRoot ?? ""));
  if (within(store, repo)) return { ok: true, store, repo };
  // Lexically outside. Before refusing, ask the filesystem — one of the two may be a symlink into the
  // other, which is how these stores are deployed.
  //
  // EACH PATH FALLS BACK TO ITS OWN LEXICAL FORM, rather than the pair falling back to "contained". A path
  // that does not exist yet is still misconfigured if it names another tree: the service would create the
  // directory and then fail every commit into it, which is the whole defect. Resolution can therefore only
  // RESCUE a lexical miss here, never manufacture one — the branch above already returned every pair the
  // lexical reading accepts.
  const rStore = real(store) ?? store, rRepo = real(repo) ?? repo;
  return { ok: within(rStore, rRepo), store: rStore, repo: rRepo };
}

/**
 * The sentence every caller says, so four deployments do not get four different explanations of the same
 * misconfiguration. `varName` names the knob to point at the repository — that is the fix, and a message
 * that describes the fault without naming the knob makes the reader go looking for it.
 */
export function storeOutsideRepoMessage({ storeVar, storeDir, repoVar, repoRoot }) {
  return `${storeVar} (${storeDir}) is outside ${repoVar} (${repoRoot}) — a save writes the file and then `
    + `commits it, and git cannot stage a path outside its own repository. EVERY save would leave an `
    + `untracked file behind, and the next store sync refuses on the dirty tree. Point ${repoVar} at the `
    + `repository that contains the store.`;
}

// ── THE SECOND HALF: THE ROW THAT DESCRIBES THE CHANGE MUST RIDE IN THE CHANGE ──────────────
//
// The guard above stops a store the service could never commit into. It does not stop the orphan this
// issue is named for, and reopening it is what made that clear: a correctly-configured store still
// leaves a file behind on EVERY save.
//
// The save committed the profile and then appended the audit row. `git add` was never told about the
// row, so with PROFILE_AUDIT unset — the default, and what the live store runs — the append lands
// INSIDE the store and nothing ever stages it. The config repo carries no `.gitignore`, so there is no
// state in which that file is quietly ignored: it is either committed or it is dirt. Measured on the
// live store: `profiles/_audit.log` is git-tracked, and its last commit is `Backup config store
// (2026-07-27T14:24:14Z)` — a sweep job. The rows are not committed by the saves that wrote them; they
// are picked up out of band, by something that is not part of the save, or not at all.
//
// So the audit trail is detached from what it describes. `git revert` on a bad profile change leaves
// its row behind, and `git checkout -- .` on a dirty store destroys rows for changes that are still
// live. That is the opposite of an audit trail's one job.
//
// ── WHY THE ROW NO LONGER CARRIES THE COMMIT SHA ─────────────────────────────────────────────────────
//
// It cannot. Committing the row with the change means writing the row FIRST, and a row inside a commit
// cannot name that commit's own sha. The exchange is worth it and the sha is not lost: the commit that
// CONTAINS the row is the answer, which `git log` gives directly and which — unlike a copied sha — can
// never disagree with where the row actually is.
//
// `commitError` moves with it, and it already had two channels that survive: the save's HTTP response
// names it to whoever made the change, and both services log it to the journal. What is gone is a third
// copy in a row that, on exactly the failure it described, was never committed anyway.
//
// ── WHY THE APPENDER DECIDES, AND NOT THE CORE ───────────────────────────────────────────────────────
//
// An audit path pointed OUTSIDE the repository must not be staged: `git add` would refuse and take a
// commit that was working down with it. That turns a deployment choice into an outage, which is the
// direction this file already refuses to fail in. The core does not know the repo root; the wiring
// knows both. So the appender returns a path only when that path is committable, and the core commits
// what it is handed.

import { appendFileSync } from "node:fs";

/**
 * A repo root is a PATH, and every helper below interpolates it into a git invocation. Anything else
 * reaches git as whatever it stringifies to — an object arrives as the literal `[object Object]`, and
 * git then reports `cannot change to '[object Object]'`, which reads as a broken store and sends the
 * operator to fix a store that was never wrong. Two commands shipped with exactly that: they passed
 * the RESOLVER'S RESULT where its `.root` belongs, so the record half of every add died on every store
 * and the message blamed the store for a caller's bug.
 *
 * The resolver returns `{ root, from, tried }` because two callers need `from` and `tried` to say
 * which variable answered. That shape is worth keeping and it is exactly what makes the mistake easy,
 * so the refusal lives HERE, at the boundary every caller crosses, rather than in a rule each new
 * caller has to remember. It fires before any git process starts, and it names the fix.
 *
 * Null is refused too, not tolerated. `resolveStoreRepoRoot` returns `{ root: null }` when nothing
 * answered and no fallback was given; passing that on reaches `execFileSync` as a null argument and
 * dies as a TypeError about argument types, which names neither the store nor the caller.
 */
function requireRepoRootPath(repoRoot, fn) {
  if (typeof repoRoot === "string" && repoRoot.trim()) return repoRoot;
  const shown = repoRoot === null || repoRoot === undefined
    ? String(repoRoot)
    : `${typeof repoRoot}${typeof repoRoot === "object" ? ` (${Object.keys(repoRoot).join(", ") || "no keys"})` : ""}`;
  throw new TypeError(
    `${fn}: repoRoot must be a non-empty path string, got ${shown}. `
    + "resolveStoreRepoRoot returns { root, from, tried } — pass its .root, not the result object.");
}

/**
 * An audit appender whose return value tells the core whether the row can ride in the commit.
 *
 * @returns {(rec: object) => string|null}  the path to stage, or null when the row was written
 *   somewhere no commit from `repoRoot` could reach it — and null when the append itself failed, so a
 *   row that does not exist is never handed to `git add`.
 */
export function makeCommittableAudit({ auditPath, repoRoot }) {
  requireRepoRootPath(repoRoot, "makeCommittableAudit");
  // Decided ONCE, at wiring time, over the audit file's DIRECTORY — which is the same input the boot
  // guard reads, and that is the whole point.
  //
  // ASKING ABOUT THE FILE INSTEAD IS SILENTLY WRONG ON THE PRODUCTION LAYOUT. `storeInRepo` tries the
  // lexical reading first and falls back to the symlink-resolved one; a path that cannot be read falls
  // back to its own lexical form. The store DIRECTORY exists, so it resolves. The audit file does not
  // exist yet at wiring time, so it does not — and under a store reached through a symlink (every
  // `/opt/cordillera/...` deployment) the resolved repo root and the unresolved file path have nothing
  // in common. The guard one screen up would pass, this would answer `false`, no row would ever be
  // staged, and NOTHING WOULD RED: the failure is a return value nobody asserts on. Measured, before
  // the arm below existed: boot guard true, file-level test false, same two directories.
  const committable = storeInRepo(dirname(auditPath), repoRoot).ok;
  return (rec) => {
    try { appendFileSync(auditPath, JSON.stringify({ at: new Date().toISOString(), ...rec }) + "\n"); }
    catch { return null; }   // best-effort, unchanged: a save is not failed over its journal line
    return committable ? auditPath : null;
  };
}

/**
 * Write the audit row, then commit it together with the files it describes.
 *
 * The ORDER is the fix. Three save paths carried the same four lines in the other order; a helper is
 * what stops the next one being written the old way, and what stops two of the three being fixed.
 *
 * @returns {{ commit: string|null, commitError: string|null }}  exactly what the callers already put on
 *   their responses — this changes what lands in git, not what a caller is told.
 */
export function commitWithAuditRow({ audit, gitCommit, files, message, by, row }) {
  // The row is written EVEN IF the commit then fails. That was the 2026-07-18 fix at all three sites and
  // it still holds: a live mutation with no record of who made it is the worse failure of the two.
  let auditFile = null;
  try { auditFile = audit(row) ?? null; } catch { auditFile = null; }
  let commit = null, commitError = null;
  try { commit = gitCommit({ files: auditFile ? [...files, auditFile] : files, message, author: by }); }
  catch (e) { commitError = String(e?.message ?? e).slice(0, 300); }
  // ── AND THE TRAIL SAYS WHEN IT DID NOT PERSIST ───────────────────────────────
  //
  // The row above is composed BEFORE the commit is attempted, so it read exactly like a save that
  // worked. The owner created a project through the portal, the commit was refused, and the audit line
  // said `project-create` with nothing to distinguish it from one that persisted — which makes the audit
  // trail itself wrong, and it is the trail somebody reaches for precisely when they are asking what
  // really happened.
  //
  // A SECOND ROW rather than a corrected first one: the first row's guarantee is that it exists before
  // anything can fail, and rewriting it would put that guarantee back at risk for the sake of tidiness.
  // Two rows also read correctly in the order they happened — the change was made, then it did not stick.
  //
  // The message the callers show says "the audit line records the gap". Until this, it did not.
  if (commitError) {
    try {
      audit({ event: "store-commit-failed", of: row?.event ?? null, key: row?.key ?? null, by,
        detail: commitError.slice(0, 200),
        note: "the change is LIVE on disk and NOT committed — the row above did not persist to the store's git" });
    } catch { /* the save's own failure is already reported; a second audit failure must not mask it */ }
  }
  return { commit, commitError };
}

// ── — ONE RESOLUTION OF "WHICH TREE DO SAVES COMMIT INTO", FOR EVERY DOOR ──────────────────────
//
// The portal and the standalone recipe-service resolved it differently and produced OPPOSITE outcomes
// from the SAME environment. On the test instance, with `RECIPE_REPO_ROOT` unset:
//
//   portal-service   RECIPE_REPO_ROOT || <the profile repo root>   → the config store → saves work
//   recipe-service   RECIPE_REPO_ROOT || join(HERE, "..")          → the PRODUCT CHECKOUT → FATAL
//
// Two ends of one contract measuring different things ('s class). The portal consulted the profile
// root as a second chance and the recipe-service did not, so one door came up and the other exited 1.
//
// AND THE DIVERGENT FALLBACK IS THE DANGEROUS ONE, which is why this is not merely tidying. The product
// checkout is the hourly `--ff-only` deploy target. A resolution that lands there does not fail — it
// SUCCEEDS, commits saved searches into the deploy branch, diverges it and blocks the next deploy. That
// is the failure was opened for, arriving through the other door.
//
// THE ORDER IS THE WHOLE CONTRACT, so it is stated once here rather than typed at each door:
//   1. `RECIPE_REPO_ROOT` — the operator naming the tree outright.
//   2. `PROFILE_REPO_ROOT` — the config store. The roster and the recipe store must come from one
//      universe (recipe-service's own 2026-07-18 review note), so the profile side's tree is the right
//      second answer, and it is the one that makes the test instance work.
//   3. The module-relative product checkout — LAST, and kept only because a fresh clone with no
//      environment at all still has to serve its in-repo demo recipes. It is the answer that can commit
//      into the deploy target, so it is the answer of last resort rather than the second one.
//
// Returns `from` as well as `root` because a reader of a refusal needs to know WHICH name answered —
// "outside the repo root" is unactionable without knowing which variable supplied that root.
// ── — ONE STORE COMMITTER, AND A STAGED TREE IS A CHECKPOINT RATHER THAN A BLOCKER ──────────
//
// The same three commands lived in profile-service, recipe-service, portal-service and the test file's
// own fixture — four hand-maintained copies, and the recipe-service one had no failure logging at all.
// Nobody saw that because each copy reads fine on its own.
//
// NOTHING UN-STAGES ANYTHING, and that is the whole design. left a commit that fails after
// `git add` leaving staged, uncommitted paths. The obvious remedy — restore --staged what this save
// introduced — was measured and it is wrong: on a newly created audit row it produces `?? _audit.log`,
// UNTRACKED, which is the state was opened for and the one a sync cannot resolve on its own. There
// is no "restore to before" for a file that did not exist before.
//
// So a staged tree is left exactly as found, and the NEXT save through completes the commit it finds.
// That makes the failure resumable, and it makes "a concurrent editor's staged work survives" true by
// construction rather than by a careful reset that has to guess whose paths are whose.
import { execFileSync } from "node:child_process";

// Lock contention is TRANSIENT and worth retrying. A hook rejection and a full disk are not: retrying
// them turns one named failure into several and delays the report. The distinction is the reason this
// is a predicate rather than a blanket retry.
export const isTransientGitFault = (detail) =>
  /index\.lock|another git process seems to be running|Unable to create/i.test(String(detail ?? ""));

export function makeStoreCommit({ repoRoot, log = () => {}, what = "store", retries = 3, waitMs = 50 }) {
  requireRepoRootPath(repoRoot, "makeStoreCommit");
  const git = (...args) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).toString().trim();
  // ── IS THIS A REPOSITORY WE CAN USE? ASKED FIRST ─────────────────────────────
  //
  // Outside a repository git falls back to `--no-index` mode, which has no `--cached` — so the very
  // first command below produced `error: unknown option 'cached'` and twenty lines of diff usage. The
  // real cause was `fatal: detected dubious ownership`, one `rev-parse` away, and nothing ran it. A
  // reader saw a malformed git invocation and had no way to reach the refusal underneath.
  //
  // `rev-parse --git-dir` is the cheapest question that gets the true answer: it succeeds inside a
  // usable repository and fails with the ACTUAL refusal — ownership, missing, or not a repo at all —
  // everywhere else.
  const repoRefusal = () => {
    try { git("rev-parse", "--git-dir"); return null; }
    catch (e) { return String(e?.stderr ?? e?.message ?? e).trim().split("\n")[0].slice(0, 200); }
  };
  const napping = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best effort */ } };
  const detailOf = (e) => String(e?.stderr ?? e?.message ?? e);

  return ({ files, message, author }) => {
    // Asked BEFORE anything composes a diff, so the caller gets the refusal rather than a fallback-mode
    // parse error. Throwing here also means the write is never followed by a silent half-save: the
    // caller's own catch is what turns this into a failed save.
    const refusal = repoRefusal();
    if (refusal) {
      log(`${what}: the store is not a usable git repository, so this save CANNOT be committed — ${refusal}`);
      throw new Error(`the store at ${repoRoot} is not a usable git repository: ${refusal}`);
    }
    // (1) Complete what an earlier failed save left staged. BEST EFFORT: if this fails too — the same
    // hook is still rejecting, the disk is still full — it must not stop the save that is happening now,
    // and it must not touch the index either. The paths simply stay staged for the next attempt.
    try {
      const found = git("diff", "--cached", "--name-only").split("\n").filter(Boolean);
      if (found.length) {
        git("commit", "-m", `Complete a store save left staged by an earlier failure (${found.length} path(s))`,
            "--author", `${author} <${author}>`);
        log(`${what}: completed a commit left staged by an earlier failed save — ${found.join(", ")}`);
      }
    } catch (e) {
      log(`${what}: found staged paths from an earlier failed save and could not complete them (${detailOf(e).slice(0, 200)}) `
        + "— they stay staged, which is the recoverable state, and the save below continues");
    }

    git("add", ...files);
    for (let attempt = 1; ; attempt++) {
      try {
        git("commit", "-m", message, "--author", `${author} <${author}>`);
        return git("rev-parse", "HEAD");
      } catch (e) {
        const detail = detailOf(e);
        if (isTransientGitFault(detail) && attempt <= retries) { napping(waitMs * attempt); continue; }
        // NAMED, not merely reported. 's line held that a failed commit is a permanent sync blocker
        // and belongs in the journal; it is no longer permanent — the next save completes it — but the
        // operator still needs to know WHICH fault, because a hook and a full disk want different people.
        log(`${what} COMMIT FAILED after the write landed — the save is LIVE and the paths are STAGED, `
          + `which the next save will complete. Fault: ${detail.slice(0, 200)}`);
        throw e;
      }
    }
  };
}

export function resolveStoreRepoRoot({ names, fallback = null, env = process.env } = {}) {
  const tried = [];
  for (const n of Array.isArray(names) ? names : []) {
    tried.push(n);
    const v = String(env?.[n] ?? "").trim();
    if (v) return { root: v, from: n, tried };
  }
  if (fallback) return { root: fallback, from: "module-relative fallback", tried };
  return { root: null, from: null, tried };
}
