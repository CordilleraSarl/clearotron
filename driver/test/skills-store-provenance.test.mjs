// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the doctrine store the engine serves from must be a tree somebody else can check out.
//
// The states that CAN be built are built, in real git repositories in a temp dir: an invented fixture
// here would certify whatever this module happens to do rather than what git actually reports, and the
// pathspec/porcelain details are exactly where that would bite. Offline, no network, no remotes.
//
// Injection is reserved for the states a test cannot create: git absent from PATH, and an ancestor
// directory this process may not look inside. Both of those must land on `blocked`, never on a pass —
// that is the whole point of the module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { classifySkillsStore, findCheckoutRoot, describeSkillsStore, preflightSkillsStore, STRICT_VAR, MAIN_BRANCH_VAR }
  from "../skills-store-provenance.mjs";

const TRASH = [];
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A real repository on `branch`, with a doctrine store at <root>/skills and one commit. */
function repo({ branch = "main" } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "skills-store-847-")));
  TRASH.push(root);
  // `-b <branch>` explicitly: a box whose git defaults to `master` would otherwise make every
  // main-line assertion below a statement about this machine's git config.
  git(root, "init", "-q", "-b", branch);
  git(root, "config", "user.email", "guard@example.invalid");
  git(root, "config", "user.name", "guard");
  mkdirSync(join(root, "skills", "prelim-search"), { recursive: true });
  writeFileSync(join(root, "skills", "prelim-search", "digest.md"), "committed doctrine\n");
  writeFileSync(join(root, "README.md"), "outside the store\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "doctrine");
  return { root, store: join(root, "skills") };
}

test.after(() => { for (const d of TRASH) rmSync(d, { recursive: true, force: true }); });

// ── the pass cases ────────────────────────────────────────────────────────────────────────────────

test("a clean store on the main line passes, and says which commit served it", () => {
  const { root, store } = repo();
  const r = classifySkillsStore(store);
  assert.equal(r.outcome, "pass", describeSkillsStore(r));
  assert.deepEqual(r.findings, []);
  assert.equal(r.situation, "checkout");
  assert.equal(r.repoRoot, root);
  assert.equal(r.branch, "main");
  assert.match(r.head, /^[0-9a-f]{40}$/, "the serving commit is recorded, not just judged");
});

test("CLEAROTRON_INSTRUCTIONS_DIR unset is a store-less deployment, not an unknown store", () => {
  const r = classifySkillsStore(null);
  assert.equal(r.outcome, "pass");
  assert.equal(r.situation, "no-overlay");
});

test("a plain directory outside every checkout is AFFIRMATIVELY identified, not inferred", (ctx) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "skills-store-847-plain-")));
  TRASH.push(dir);
  mkdirSync(join(dir, "skills"), { recursive: true });
  const where = findCheckoutRoot(join(dir, "skills"));
  // An honest skip rather than a silent pass: on a box whose TMPDIR sits inside a checkout this case
  // cannot be built, and asserting it anyway would be asserting about that checkout.
  if (where.kind !== "plain") return ctx.skip(`${tmpdir()} is inside a checkout (${where.root ?? where.reason}) — the plain-directory case cannot be built here`);
  const r = classifySkillsStore(join(dir, "skills"));
  assert.equal(r.outcome, "pass");
  assert.equal(r.situation, "plain-directory");
  assert.match(r.detail.join(" "), /every one of its ancestors/, "the pass states what was established, not what was missing");
});

test("dirt OUTSIDE the served path is not this guard's business", () => {
  const { root, store } = repo();
  writeFileSync(join(root, "README.md"), "edited\n");
  const r = classifySkillsStore(store);
  assert.equal(r.outcome, "pass", describeSkillsStore(r));
  assert.deepEqual(r.dirt, []);
});

test("a detached HEAD at a commit contained in the main line passes — a pinned deployment is normal", () => {
  const { root, store } = repo();
  const head = git(root, "rev-parse", "HEAD");
  git(root, "checkout", "-q", "--detach", head);
  const r = classifySkillsStore(store);
  assert.equal(r.outcome, "pass", describeSkillsStore(r));
  assert.equal(r.branch, null, "detached is recorded as detached");
});

// ── the fail cases ────────────────────────────────────────────────────────────────────────────────

test("an uncommitted edit under the served path fails", () => {
  const { store } = repo();
  writeFileSync(join(store, "prelim-search", "digest.md"), "draft nobody committed\n");
  const r = classifySkillsStore(store);
  assert.equal(r.outcome, "fail");
  assert.deepEqual(r.findings, ["dirty"]);
  assert.equal(r.dirt.length, 1);
});

test("an UNTRACKED file under the served path fails too — a stray doctrine file matches no commit", () => {
  const { store } = repo();
  writeFileSync(join(store, "prelim-search", "stray.md"), "nobody's document\n");
  const r = classifySkillsStore(store);
  assert.equal(r.outcome, "fail");
  assert.deepEqual(r.findings, ["dirty"]);
});

test("a store on a feature branch fails, and names the branch", () => {
  const { root, store } = repo();
  git(root, "checkout", "-q", "-b", "rescue/580-worktree");
  writeFileSync(join(store, "prelim-search", "digest.md"), "branch doctrine\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "branch work");
  const r = classifySkillsStore(store);
  assert.equal(r.outcome, "fail");
  assert.deepEqual(r.findings, ["off-main"]);
  assert.equal(r.branch, "rescue/580-worktree");
  assert.match(describeSkillsStore(r), /not contained in main/);
});

test("a detached HEAD off the main line fails — detached is not collapsed into either answer", () => {
  const { root, store } = repo();
  git(root, "checkout", "-q", "-b", "side");
  writeFileSync(join(store, "prelim-search", "digest.md"), "side doctrine\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "side");
  git(root, "checkout", "-q", "--detach", git(root, "rev-parse", "HEAD"));
  const r = classifySkillsStore(store);
  assert.equal(r.outcome, "fail");
  assert.deepEqual(r.findings, ["off-main"]);
  assert.equal(r.branch, null);
});

test("both faults at once are both reported", () => {
  const { root, store } = repo();
  git(root, "checkout", "-q", "-b", "wip");
  writeFileSync(join(store, "prelim-search", "digest.md"), "branch doctrine\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "branch work");
  writeFileSync(join(store, "prelim-search", "digest.md"), "and an uncommitted draft on top\n");
  const r = classifySkillsStore(store);
  assert.equal(r.outcome, "fail");
  assert.deepEqual(r.findings.sort(), ["dirty", "off-main"]);
});

test("the main-line branch name is configurable — a store on `master` is not off-main by definition", () => {
  const { store } = repo({ branch: "master" });
  // Under the default `main` this repo has no main-line ref at all, so the honest answer is the third
  // one — BLOCKED, not a verdict of off-main against a ref that does not exist.
  assert.equal(classifySkillsStore(store).outcome, "blocked");
  const r = classifySkillsStore(store, { mainBranch: "master" });
  assert.equal(r.outcome, "pass", describeSkillsStore(r));
});

// ── the third outcome: could not determine ────────────────────────────────────────────────────────

test("git missing from PATH is BLOCKED, never a pass", () => {
  const { store } = repo();
  const exec = () => { const e = new Error("spawn git ENOENT"); e.code = "ENOENT"; throw e; };
  const r = classifySkillsStore(store, { exec });
  assert.equal(r.outcome, "blocked");
  assert.deepEqual(r.findings, ["undetermined"]);
});

test("a git call that dies without an exit code is BLOCKED, not read as a verdict", () => {
  const { store } = repo();
  // A timeout kill: no numeric status, only a signal. `merge-base --is-ancestor` answers with exit 1,
  // so a module that treated "non-zero" as "not an ancestor" would call this off-main instead.
  const exec = () => { const e = new Error("killed"); e.signal = "SIGTERM"; throw e; };
  const r = classifySkillsStore(store, { exec });
  assert.equal(r.outcome, "blocked");
});

test("an ancestor this process cannot look inside is BLOCKED, never plain-directory", () => {
  const io = {
    statSync: () => ({ isDirectory: () => true }),
    lstatSync: () => { const e = new Error("EACCES"); e.code = "EACCES"; throw e; },
    realpathSync: (p) => p,
  };
  const where = findCheckoutRoot("/somewhere/config/skills", io);
  assert.equal(where.kind, "blocked", "absence of git evidence under a directory we cannot read is not absence of a checkout");
  const r = classifySkillsStore("/somewhere/config/skills", { io });
  assert.equal(r.outcome, "blocked");
});

test("a store inside a checkout that tracks nothing under it is BLOCKED — `status` reporting nothing is not clean", () => {
  const { root } = repo();
  const store = join(root, "generated-skills");
  mkdirSync(store, { recursive: true });
  writeFileSync(join(root, ".gitignore"), "generated-skills/\n");
  writeFileSync(join(store, "digest.md"), "rendered, committed nowhere\n");
  git(root, "add", ".gitignore");
  git(root, "commit", "-qm", "ignore the rendered tree");
  const r = classifySkillsStore(store);
  assert.equal(r.outcome, "blocked", describeSkillsStore(r));
  assert.match(describeSkillsStore(r), /tracks no file under it/);
});

test("no main-line ref to compare against is BLOCKED, not a pass", () => {
  const { store } = repo({ branch: "trunk" });   // no `main`, no origin
  const r = classifySkillsStore(store);
  assert.equal(r.outcome, "blocked");
  assert.match(describeSkillsStore(r), /nothing to measure/);
});

// ── the door ──────────────────────────────────────────────────────────────────────────────────────

test("the door WARNS by default and REFUSES only under the strict flag", () => {
  const { store } = repo();
  writeFileSync(join(store, "prelim-search", "digest.md"), "draft\n");

  const soft = preflightSkillsStore({ CLEAROTRON_INSTRUCTIONS_DIR: store });
  assert.equal(soft.result.outcome, "fail");
  assert.match(soft.warning, /^\[preflight\] /);
  assert.match(soft.warning, /cannot be reproduced/);

  assert.throws(() => preflightSkillsStore({ CLEAROTRON_INSTRUCTIONS_DIR: store, [STRICT_VAR]: "1" }), /\[preflight\]/);
});

test("strict mode refuses on BLOCKED too — could-not-determine is not a pass at the door either", () => {
  const { store } = repo({ branch: "trunk" });
  assert.equal(preflightSkillsStore({ CLEAROTRON_INSTRUCTIONS_DIR: store }).result.outcome, "blocked");
  assert.throws(() => preflightSkillsStore({ CLEAROTRON_INSTRUCTIONS_DIR: store, [STRICT_VAR]: "1" }), /COULD NOT BE IDENTIFIED/);
});

test("the strict flag follows the house on/off idiom — `0`, `off` and `false` do NOT arm it", () => {
  const { store } = repo();
  writeFileSync(join(store, "prelim-search", "digest.md"), "draft\n");
  for (const off of ["0", "off", "false", "no", ""])
    assert.equal(preflightSkillsStore({ CLEAROTRON_INSTRUCTIONS_DIR: store, [STRICT_VAR]: off }).result.outcome, "fail",
      `${STRICT_VAR}=${JSON.stringify(off)} must not arm hard mode — the bare-truthiness spelling arms on the value an operator uses to switch it off`);
});

test("out of hard mode the door CANNOT throw — a defect in this guard must not kill a run that never armed it", () => {
  const { store } = repo();
  // A mis-shaped git runner: it answers, but with nothing. That is the plausible defect shape — a
  // refactor that changes what the runner returns — and it reaches deep inside the classifier rather
  // than bouncing off the argument check at the top.
  const broken = { git: () => undefined };
  assert.throws(() => classifySkillsStore(store, broken), /undefined/, "premise: the classifier itself does throw on this");

  const r = preflightSkillsStore({ CLEAROTRON_INSTRUCTIONS_DIR: store }, broken);
  assert.equal(r.result.outcome, "blocked", "an exception inside the check is an unanswered question, not a verdict and not a pass");
  assert.match(r.warning, /the store check itself failed/);
  // …and hard mode still refuses on it, so the failure is not swallowed where it was asked to bite.
  assert.throws(() => preflightSkillsStore({ CLEAROTRON_INSTRUCTIONS_DIR: store, [STRICT_VAR]: "1" }, broken), /store check itself failed/);
  assert.equal(preflightSkillsStore({ CLEAROTRON_INSTRUCTIONS_DIR: store }).result.outcome, "pass", "control: the same door on a healthy store still passes");
});

test("a clean store produces NO warning at the door — the guard is silent when there is nothing to say", () => {
  const { store } = repo();
  const r = preflightSkillsStore({ CLEAROTRON_INSTRUCTIONS_DIR: store });
  assert.equal(r.warning, null);
  assert.equal(r.result.outcome, "pass");
});

test("the main-branch override reaches the door by environment", () => {
  const { store } = repo({ branch: "master" });
  assert.equal(preflightSkillsStore({ CLEAROTRON_INSTRUCTIONS_DIR: store }).result.outcome, "blocked");
  assert.equal(preflightSkillsStore({ CLEAROTRON_INSTRUCTIONS_DIR: store, [MAIN_BRANCH_VAR]: "master" }).result.outcome, "pass");
});
