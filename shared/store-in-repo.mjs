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

import { resolve, dirname, relative, isAbsolute } from "node:path";
import { realpathSync } from "node:fs";

/** `resolve`, then the symlink-resolved form when the path exists — null when it cannot be read. */
const real = (p) => { try { return realpathSync(resolve(p)); } catch { return null; } };

// CONTAINMENT IS ASKED OF THE PATH LIBRARY, NOT OF THE STRING.
//
// This was `dir.startsWith(root + "/")`, with the separator written in. On Windows `resolve()` returns
// backslashes, so `C:\…\config\recipes` does not start with `C:\…\config/` and a folder plainly inside
// its parent read as OUTSIDE — an operator on a correct install was told their recipe store was outside
// the repository root, and the saved-search door refused. Measured on his paths.
//
// The posix control passed throughout, which is why it survived: the string test is right on the platform
// it was written on and wrong on the one nobody here runs.
//
// `relative` also settles two cases a prefix test gets wrong on Windows even with the separator fixed: a
// different drive letter yields an absolute path rather than a `..` walk, and path comparison there is
// case-insensitive in a way `startsWith` is not. A sibling directory whose name merely begins with the
// root's — `config` and `configXX` — is still outside, which the old `+ "/"` also got right and any
// replacement had to keep.
// `impl` is the path module to ask, injected ONLY so a check can drive the Windows behaviour from a
// Linux runner. That matters here more than usual: this defect was invisible on the platform every one
// of us runs, and a guard that can only be exercised on Windows is a guard nobody will ever see fail.
export const within = (dir, root, impl = { relative, isAbsolute }) => {
  const rel = impl.relative(root, dir);
  return rel === "" || (!rel.startsWith("..") && !impl.isAbsolute(rel));
};

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
// Two ends of one contract measuring different things (the class). The portal consulted the profile
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
        // NAMED, not merely reported. That line held that a failed commit is a permanent sync blocker
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

// ── WHERE A SAVE GOES AFTER IT IS COMMITTED ──────────────────────────────────────────────────────────
//
// Everything above ends at a commit. Nothing in this file pushes, and nothing should: what happens to a
// commit next is a property of the repository the store sits in, not of the save. When that repository's
// branch tracks a remote one, the next person who syncs or pushes the checkout publishes every save made
// there, and that person is usually not the one who made them.
//
// Measured on a test instance, 2026-09-10: its store sat inside a checkout that people also synced for
// unrelated work. A company created in the portal was committed there as designed, waited eleven hours
// as a local commit, and went out with an ordinary pull-then-push. It had happened the evening before,
// and the only thing that stopped that one was somebody noticing.
//
// THIS IS A REPORT, NEVER A REFUSAL. Keeping a store in a repository you push on purpose is a
// reasonable deployment, and the harm needs a second person doing ordinary git work in the same checkout,
// which no service can see. So the answer is for whoever reads it (doctor), and no save waits on it.
//
// READ FROM THE BRANCH'S TRACKING CONFIGURATION, NOT FROM `@{u}`. The clone of an empty remote has its
// tracking configured and nothing to resolve `@{u}` to until the first commit, so `@{u}` answers with a
// usage error for a store whose first save a bare push WOULD publish. The configuration answers the
// question actually being asked: will a push or pull with no arguments carry this branch anywhere?
//
// NO FETCH. A doctor that reaches the network hangs on a box without a route, and the count of commits
// waiting is measured against the last fetch, which is enough: a commit made here is ahead of any
// version of the remote branch until somebody pushes it.

/**
 * Where does a save committed in `dir`'s repository go next? Read-only.
 *
 * @param {string} dir  the store directory — any directory inside the repository; git finds the root
 * @param {{ env?: object, gitVersion?: string }} [opts]  the environment git runs in — a caller can bound the
 *   search upwards — and, for a test, the `git version` answer to reason from instead of asking git
 * @returns one of:
 *   `{ state: "publishes", root, branch, upstream, ahead, via }` — a push with no arguments carries the store's
 *     commits out: the branch tracks a remote branch (`via: "tracking"`), or it tracks none and git's push
 *     settings send it anyway (`via` names the setting). `ahead` counts the commits waiting, or is null when
 *     git cannot count them (nothing to count against yet).
 *   `{ state: "stays-here", root, branch, remotes }` — no tracking branch (or no branch at all), and no push
 *     setting that sends it anyway: nothing leaves unless someone pushes it by name. `remotes` lists the remotes such a push could name.
 *   `{ state: "not-a-repository", why }` — a save through a door is refused until the store is in one.
 *   `{ state: "could-not-look", why }` — git would not answer: a missing directory, a repository owned
 *     by another account, no git on the path. Never read as either answer above.
 */
export function whereSavesGo(dir, { env = process.env, gitVersion = null } = {}) {
  const ask = (...args) => {
    try {
      return { ok: true, out: execFileSync("git", ["-C", String(dir ?? ""), ...args],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env }).trim() };
    } catch (e) {
      return { ok: false, status: e?.status ?? null,
        why: String(e?.stderr || e?.message || e).trim().split("\n")[0].slice(0, 200) };
    }
  };
  const top = ask("rev-parse", "--show-toplevel");
  if (!top.ok) {
    return /not a git repository/i.test(top.why)
      ? { state: "not-a-repository", why: top.why }
      : { state: "could-not-look", why: top.why };
  }
  const root = top.out;
  const listed = ask("remote");
  if (!listed.ok) return { state: "could-not-look", why: listed.why };
  const remotes = listed.out.split("\n").filter(Boolean);
  // `-q` makes a detached HEAD a quiet exit 1, which is an answer (no branch, so nothing tracks). Any
  // other failure is git refusing to say, and is reported as that.
  const head = ask("symbolic-ref", "--short", "-q", "HEAD");
  if (!head.ok) return head.status === 1 ? { state: "stays-here", root, branch: null, remotes } : { state: "could-not-look", why: head.why };
  const branch = head.out;
  // `config --get` exits 1 for a key that is not set, which is again an answer; anything else is not.
  const setting = (key) => {
    const r = ask("config", "--get", key);
    if (r.ok) return { value: r.out };
    return r.status === 1 ? { value: null } : { why: r.why };
  };
  const remote = setting(`branch.${branch}.remote`);
  if (remote.why) return { state: "could-not-look", why: remote.why };
  // A branch tracking another LOCAL branch names the remote `.`: a pull merges within this repository,
  // and unless a push remote is named below, a push goes nowhere else.
  if (!remote.value || remote.value === ".") {
    // ── NO TRACKING IS NOT THE SAME AS NOTHING LEAVES ────────────────────────────────────────────────
    //
    // A bare `git push` on a branch with no tracking still publishes it in three configurations. Measured
    // with git 2.43 against real remotes, 2026-09-10, after a review drove the first one:
    // `push.autoSetupRemote=true` (the push sets up tracking as it goes), `push.default=current`, and
    // `push.default=matching` once the remote has a branch of the same name. `upstream` and `nothing` refuse
    // with no upstream. Git's default, `simple`, refuses too, UNLESS the push is triangular: a push remote
    // (the branch's `pushRemote`, or `remote.pushDefault`) that is not the remote the branch fetches from.
    // Then `simple` pushes as `current` does. A review drove that case with git 2.43 after this comment had
    // said `simple` refuses whenever only those keys are set; that is true only while they name the fetch
    // remote. Where a push goes is git's order: the branch's push remote, then `remote.pushDefault`, then
    // `origin`, then the only remote there is. The remote a branch with no upstream fetches from is found
    // the same way without the first two. The test beside this pushes for real in each configuration and
    // holds this function to what git did.
    const pushRemote = setting(`branch.${branch}.pushRemote`), pushDefault = setting("remote.pushDefault"), mode = setting("push.default");
    for (const x of [pushRemote, pushDefault, mode]) if (x.why) return { state: "could-not-look", why: x.why };
    const auto = ask("config", "--type=bool", "--get", "push.autoSetupRemote");
    if (!auto.ok && auto.status !== 1) return { state: "could-not-look", why: auto.why };
    // ── WHICH GIT IS ANSWERING ─────────────────────────────────────────────────────────────────────────
    //
    // Two of these rules arrived in git 2.37.0: `push.autoSetupRemote`, and the fallback that makes the only
    // remote the default when it is not named `origin`. Before 2.37 the default remote is `origin` whether
    // or not one exists, so a lone remote with another name is never the default. A push remote naming it
    // is then triangular against a missing `origin`, and `simple` pushes. A review found that for the git on
    // Ubuntu 22.04 (2.34), where the 2.37 reading here said the store stayed: a missed publish, the one
    // direction this must not err in. A version git will not state is read both ways, below.
    const ver = /(\d+)\.(\d+)/.exec(String(gitVersion ?? ask("version").out ?? ""));
    const pushing = mode.value || "simple";
    const reading = (modern) => {
      const fallback = remotes.includes("origin") ? "origin" : modern && remotes.length === 1 ? remotes[0] : null;
      const fetchesFrom = remote.value || (modern ? fallback : "origin");
      const dest = pushRemote.value || pushDefault.value || (remote.value === "." ? null : fallback);
      const triangular = dest !== fetchesFrom;
      const autoOn = modern && auto.ok && auto.out === "true";
      const via = !dest || !remotes.includes(dest) ? null
        : pushing === "current" ? "push.default is current"
        // `upstream` refuses a push to a remote the branch does not fetch from, tracking set up or not:
        // "You are pushing to remote 'x', which is not the upstream of your current branch".
        : autoOn && (pushing === "simple" || (pushing === "upstream" && !triangular)) ? "push.autoSetupRemote is on"
        : pushing === "simple" && triangular ? `push.default is simple, and it pushes to ${dest}, not the remote this branch fetches from`
        : pushing === "matching" && ask("rev-parse", "--verify", "-q", `refs/remotes/${dest}/${branch}`).ok
          ? "push.default is matching, and the remote has this branch"
        : null;
      return { via, dest };
    };
    // A GIT THAT WILL NOT STATE ITS VERSION IS READ BOTH WAYS, and publishing wins. Reading it as current
    // was the exception to "never err toward staying": in the lone-remote case the older reading is the one
    // that publishes. A review of that exception named it; every real git states its version, so this
    // costs nothing today and removes the one case where the promise above did not hold.
    const modernNow = ver && (Number(ver[1]) > 2 || (Number(ver[1]) === 2 && Number(ver[2]) >= 37));
    const now = ver ? reading(modernNow) : reading(true);
    const older = ver ? null : reading(false);
    const r = now.via ? now
      : older?.via ? { ...older, via: `${older.via}, as a git older than 2.37 would push it; this git did not state its version` }
      : now;
    const { via, dest } = r;
    if (!via) return { state: "stays-here", root, branch, remotes };
    const known = ask("rev-list", "--count", `refs/remotes/${dest}/${branch}..HEAD`);
    return { state: "publishes", root, branch, upstream: `${dest}/${branch}`, via,
      ahead: known.ok && /^\d+$/.test(known.out) ? Number(known.out) : null };
  }
  const merge = setting(`branch.${branch}.merge`);
  if (merge.why) return { state: "could-not-look", why: merge.why };
  const upstream = `${remote.value}/${String(merge.value ?? branch).replace(/^refs\/heads\//, "")}`;
  const count = ask("rev-list", "--count", "@{u}..HEAD");
  const ahead = count.ok && /^\d+$/.test(count.out) ? Number(count.out) : null;
  return { state: "publishes", root, branch, upstream, ahead, via: "tracking" };
}
