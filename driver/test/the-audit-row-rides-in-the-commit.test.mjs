// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//, reopened — after a save, the config store's git tree is CLEAN.
//
// THE FIRST CURE WAS VERIFIED BY THE WRONG INSTRUMENT, AND THAT IS THE LESSON HERE. It shipped eleven
// arms and a boot guard, all of which tested CONFIGURATION: is the store inside the repository the
// service commits from. Every one passed, and the orphan the issue is named for survived untouched,
// because it is not a configuration fault. A correctly-configured store still left a file behind on
// every save: the commit staged the profile and nothing else, and the audit row was appended AFTER it.
//
// So this file executes a real save through the real writer against a real git repository and reads the
// tree afterwards. No injected `gitCommit`, no injected `audit` — those are what let the first attempt
// certify itself. `profile-service.test.mjs` keeps the injected units for routing; the question HERE is
// what is on disk when the request returns, and only git can answer it.
//
// ── WHY "CLEAN TREE" IS NOT THE WHOLE ASSERTION ──────────────────────────────────────────────────────
//
// A tree is also clean when the audit row was never written at all. That is a worse bug than the one
// being fixed and it passes the obvious check, so every arm below asserts BOTH: the tree is clean AND
// the row is inside the commit that carries the profile. An absence is a finding, not a pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeProfileService } from "../profile-service.mjs";
import { makeRecipeService } from "../recipe-service.mjs";
import { makeCommittableAudit, commitWithAuditRow, makeStoreCommit } from "../../shared/store-in-repo.mjs";

const STAFF = { email: "staff@example-firm.com" };
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/** A throwaway config store: a git repo with a `profiles/` (and `recipes/`) child, seeded and committed. */
function mkStore() {
  const root = mkdtempSync(join(tmpdir(), "audit-row-repo-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example-firm.com");
  git(root, "config", "user.name", "Test");
  const profileDir = join(root, "profiles"), recipesDir = join(root, "recipes");
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(recipesDir, { recursive: true });
  writeFileSync(join(profileDir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  writeFileSync(join(profileDir, "acme.json"), JSON.stringify({ name: "Acme", platforms: ["amazon.com"] }));
  git(root, "add", "-A");
  git(root, "commit", "-qm", "seed");
  // NO .gitignore, deliberately: the live config store has none, so a file inside it is either committed
  // or it is dirt. A fixture that ignored the audit log would make every arm below vacuous.
  assert.equal(git(root, "status", "--porcelain"), "", "the fixture did not start clean");
  return { root, profileDir, recipesDir };
}

/** The real committer — THE one the services build, not a copy of it. It was a copy, and a copy in the
 *  test is the one that cannot drift-detect the other three. */
const realCommit = (root) => makeStoreCommit({ repoRoot: root, log: () => {} });

const filesInHead = (root) => git(root, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);

// ── PROFILES: THE LANE THE INCIDENT HAPPENED IN ──────────────────────────────────────────────────────

test("#1454 a save with PROFILE_AUDIT UNSET leaves the tree clean, and the row is IN the commit", async () => {
  // The default, and what the live store runs. Before this change the audit append landed inside the
  // store and nothing staged it: `git status` reported one dirty path and the next sync refused on it.
  const { root, profileDir } = mkStore();
  try {
    const auditPath = join(profileDir, "_audit.log");        // the default the services compute
    const service = makeProfileService({ profileDir, gitCommit: realCommit(root),
      audit: makeCommittableAudit({ auditPath, repoRoot: root }) });

    const r = await service.route("POST", "/profiles/acme/save", STAFF, {
      profile: { name: "Acme", platforms: ["amazon.com", "gnc.com"] },
      contextPack: "Acme is a widgets maker.",
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.written, true);
    assert.ok(r.json.commit, "the save reported no commit sha");

    assert.equal(git(root, "status", "--porcelain"), "",
      "THE ORPHAN: the save left the config store dirty. A store sync refuses on this, and on the test box "
      + "one such save blocked every hourly deploy for 19 hours.");

    // The row is in the commit — not merely absent from `git status`, which a failed append also achieves.
    const head = filesInHead(root);
    assert.ok(head.includes("profiles/_audit.log"), `the audit row is not in the commit (HEAD carries ${head.join(", ")})`);
    assert.ok(head.includes("profiles/acme.json"), "the profile is not in the commit it was supposed to ride with");
    const rows = readFileSync(auditPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, "profile-update");
    assert.equal(rows[0].by, "staff@example-firm.com");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1454 a SECOND save converges — the tree is clean again, not dirty by one accumulating line", async () => {
  // Staging the audit file as it stood BEFORE the append would commit the previous save's rows and leave
  // this one's behind: clean once, then permanently one line dirty. Only the reorder converges, so the
  // arm above passes for a fix that does not actually work. Two saves is what separates them.
  const { root, profileDir } = mkStore();
  try {
    const service = makeProfileService({ profileDir, gitCommit: realCommit(root),
      audit: makeCommittableAudit({ auditPath: join(profileDir, "_audit.log"), repoRoot: root }) });
    for (const platforms of [["amazon.com"], ["amazon.com", "gnc.com"], ["gnc.com"]]) {
      const r = await service.route("POST", "/profiles/acme/save", STAFF, { profile: { name: "Acme", platforms } });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(git(root, "status", "--porcelain"), "", `dirty after saving platforms=${platforms.join("+")}`);
    }
    const rows = readFileSync(join(profileDir, "_audit.log"), "utf8").trim().split("\n");
    assert.equal(rows.length, 3, "three saves did not produce three rows");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1454 PROFILE_AUDIT pointed OUTSIDE the repo is not staged — a wrong `git add` would be an outage", async () => {
  // The other arm of the differential. A path outside the repository must NOT be handed to `git add`:
  // git refuses the whole commit, so a deployment choice that is merely unusual would break every save.
  // This file's own rule — a false refusal is an outage, a false pass is the status quo.
  const { root, profileDir } = mkStore();
  const outside = mkdtempSync(join(tmpdir(), "audit-row-outside-"));
  try {
    const auditPath = join(outside, "_audit.log");
    const service = makeProfileService({ profileDir, gitCommit: realCommit(root),
      audit: makeCommittableAudit({ auditPath, repoRoot: root }) });
    const r = await service.route("POST", "/profiles/acme/save", STAFF, { profile: { name: "Acme", platforms: ["amazon.com"] } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.commit, "the commit failed — an out-of-repo audit path took the save down with it");
    assert.equal(git(root, "status", "--porcelain"), "", "the store is dirty");
    assert.ok(existsSync(auditPath), "the row was not written at all — the appender must still append");
    assert.ok(!filesInHead(root).includes("_audit.log"), "an out-of-repo audit path was staged");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("#1454 the PROJECT save carries the same cure — one of three sites fixed is the recurring failure", async () => {
  // profile-service has TWO save paths and recipe-service a third, all with the same four lines. This
  // codebase's most expensive shape is a control that is correct and a second place that had to carry it
  // and did not — which is what shared/store-in-repo.mjs was extracted for in the first place.
  const { root, profileDir } = mkStore();
  try {
    const service = makeProfileService({ profileDir, gitCommit: realCommit(root),
      audit: makeCommittableAudit({ auditPath: join(profileDir, "_audit.log"), repoRoot: root }) });
    const r = await service.route("POST", "/profiles/acme/projects/console/save", STAFF,
      { profile: { projectName: "Console", platforms: ["amazon.com"] } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(git(root, "status", "--porcelain"), "", "the project save left the store dirty");
    assert.ok(filesInHead(root).includes("profiles/_audit.log"), "the project save's audit row is not in its commit");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── SAVED SEARCHES: THE THIRD SITE ───────────────────────────────────────────────────────────────────

test("#1454 the RECIPE save carries it too", async () => {
  const { root, profileDir, recipesDir } = mkStore();
  try {
    const service = makeRecipeService({ recipesDir, profileDir, gitCommit: realCommit(root),
      audit: makeCommittableAudit({ auditPath: join(recipesDir, "_audit.log"), repoRoot: root }) });
    const r = await service.route("POST", "/recipes/acme/nightly/save", STAFF,
      { recipe: { label: "Nightly", base: "knockout-search" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(git(root, "status", "--porcelain"), "", "the saved-search save left the store dirty");
    assert.ok(filesInHead(root).includes("recipes/_audit.log"), "the saved-search audit row is not in its commit");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── THE FAILURE DIRECTION, WHICH IS WHERE THE 2026-07-18 FIX LIVES ───────────────────────────────────

test("#1454 a git failure still writes the row, and the response still names the error", async () => {
  // The reorder must not undo the earlier cure: a live mutation with no record of who made it is worse
  // than an uncommitted one. The row can no longer CARRY the error — it is written before the commit is
  // attempted — so the response is the channel, and this asserts that it still is.
  const { root, profileDir } = mkStore();
  try {
    const auditPath = join(profileDir, "_audit.log");
    const service = makeProfileService({ profileDir, audit: makeCommittableAudit({ auditPath, repoRoot: root }),
      gitCommit: () => { throw new Error("index.lock exists"); } });
    const r = await service.route("POST", "/profiles/acme/save", STAFF, { profile: { name: "Acme", platforms: ["amazon.com"] } });
    assert.equal(r.status, 200, "the mutation was hidden behind an error");
    assert.equal(r.json.written, true);
    assert.match(r.json.commitError, /index\.lock exists/, "the response no longer names the git failure");
    // COUNTING LINES IS THE WRONG ASSERTION for this property: the file now carries a
    // second row saying the commit did not stick. What must hold is that the MUTATION row is there and is
    // first — losing it is the 2026-07-18 defect, and a trail that cannot say a save did not persist is
    // the defect underneath it.
    const written = readFileSync(auditPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(written[0].event, "profile-update",
      "the audit row was lost when git failed — that is the 2026-07-18 defect, re-created by this fix");
    assert.ok(written.some((w) => w.event === "store-commit-failed"),
      "and the trail must record that the change is live and uncommitted");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1454 an appender that CANNOT write hands back nothing — `git add` never sees a file that is not there", async () => {
  // Best-effort, unchanged: a save is not failed over its journal line. But the null must reach the
  // committer, or a failed append becomes a failed COMMIT and the whole save dies over telemetry.
  const audit = makeCommittableAudit({ auditPath: "/proc/definitely/not/writable/_audit.log", repoRoot: "/proc" });
  assert.equal(audit({ event: "x" }), null, "an unwritable appender returned a path to stage");

  const staged = [];
  const out = commitWithAuditRow({ audit, gitCommit: ({ files }) => { staged.push(...files); return "sha"; },
    files: ["a.json"], message: "m", by: "s@example-firm.com", row: { event: "x" } });
  assert.deepEqual(staged, ["a.json"], "a file that was never written was handed to git add");
  assert.equal(out.commit, "sha");
  assert.equal(out.commitError, null);
});

test("#1454/#1573 a commit that fails AFTER `git add` leaves the tree STAGED — recoverable, and now recovered", () => {
  // Recorded rather than claimed. `gitCommit` is `git add` then `git commit`; when the second fails —
  // index.lock, a hook, a full disk — the first has already run, so the save leaves staged, uncommitted
  // paths. A store sync refuses on that exactly as it refuses on an untracked file.
  //
  // NOT A REGRESSION, and both halves of that were measured on this fixture rather than reasoned about:
  //
  //   before this change   M  profiles/acme.json   ?? profiles/_audit.log
  //   after                A  profiles/_audit.log  M  profiles/acme.json
  //
  // Same class, and the new state is the recoverable one — nothing is untracked, so clearing the fault
  // and running `git commit` completes the save. Left open deliberately: unwinding the index on failure
  // means resetting paths this process did not necessarily stage, which is a bigger change than
  // asked for and a worse failure to get wrong. CLOSED by, and NOT by unwinding the index:
    // un-staging was measured and it produces `?? _audit.log`, the untracked state this arm forbids below.
    // The staged tree is left as found and the NEXT save completes the commit it meets. See the arms
    // at the end of this file.
  const { root, profileDir } = mkStore();
  try {
    const hook = join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const service = makeProfileService({ profileDir, gitCommit: realCommit(root),
      audit: makeCommittableAudit({ auditPath: join(profileDir, "_audit.log"), repoRoot: root }) });
    return service.route("POST", "/profiles/acme/save", STAFF, { profile: { name: "Acme", platforms: ["gnc.com"] } })
      .then((res) => {
        assert.equal(res.status, 200, "the live mutation was hidden behind an error");
        assert.match(res.json.commitError, /git commit failed/, "the response must still name the failure");
        const status = git(root, "status", "--porcelain");
        assert.match(status, /_audit\.log/, "the row is not on disk at all — worse than the bug being fixed");
        assert.doesNotMatch(status, /^\?\?/m,
          "something is UNTRACKED after a failed commit — the row must at least be staged, which is the "
          + "recoverable state; an untracked file is the one a sync cannot resolve on its own");
      })
      .finally(() => rmSync(root, { recursive: true, force: true }));
  } catch (e) { rmSync(root, { recursive: true, force: true }); throw e; }
});

// ── — A STAGED TREE IS A CHECKPOINT, NOT A BLOCKER ──────────────────────────────────────────────
//
// The pin above records the open half: a commit that fails after `git add` leaves staged,
// uncommitted paths, and a store sync refuses on that.
//
// THE OBVIOUS REMEDY IS WRONG AND IT IS MEASURED WRONG, not argued. `git restore --staged` on the audit
// row turns `A profiles/_audit.log` into `?? profiles/_audit.log` — untracked, which is the state the pin
// above already forbids in as many words ("an untracked file is the one a sync cannot resolve on its
// own"). There is no "restore to before" for a file that did not exist before; un-staging is choosing a
// different failure, not undoing one.
//
// So nothing un-stages anything. The staged tree is left exactly as it is, and the NEXT thing through
// completes the commit it finds. That turns the blocker into a resumable checkpoint and it is why
// criterion 3 — a concurrently-staged path the save did not touch survives — is satisfied by
// construction rather than by a careful reset.
test("#1573 a save that meets a STAGED store completes the commit it found, and keeps that work", async () => {
  const { root, profileDir } = mkStore();
  try {
    // An earlier save that failed after `git add`: real staged state, nothing untracked.
    writeFileSync(join(profileDir, "acme.json"), JSON.stringify({ name: "Acme", platforms: ["earlier.com"] }));
    writeFileSync(join(profileDir, "_audit.log"), "the earlier row\n");
    git(root, "add", "profiles/acme.json", "profiles/_audit.log");
    assert.notEqual(git(root, "status", "--porcelain"), "", "fixture: the store must start staged-but-uncommitted");
    const before = git(root, "rev-list", "--count", "HEAD");

    const service = makeProfileService({
      profileDir,
      gitCommit: makeStoreCommit({ repoRoot: root, log: () => {} }),
      audit: makeCommittableAudit({ auditPath: join(profileDir, "_audit.log"), repoRoot: root }),
    });
    const res = await service.route("POST", "/profiles/beta/save", STAFF,
      { profile: { name: "Beta", platforms: ["later.com"] } });

    assert.equal(res.status, 200, res.json?.commitError ?? "the save failed");
    assert.equal(git(root, "status", "--porcelain"), "",
      "the tree is not clean — the staged work the save FOUND was neither committed nor left recoverable");
    assert.ok(Number(git(root, "rev-list", "--count", "HEAD")) >= Number(before) + 1,
      "no commit was created for the work that was already staged");
    assert.match(git(root, "log", "-p", "--all"), /earlier\.com/,
      "the earlier save's content is GONE — completing the found commit must preserve it, never discard it");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1573 a concurrently-staged path the save did not touch survives a failed commit", async () => {
  // The criterion that decides the approach. A naive reset passes the other two and fails this one.
  const { root, profileDir } = mkStore();
  try {
    writeFileSync(join(root, "unrelated.txt"), "someone else was mid-edit\n");
    git(root, "add", "unrelated.txt");
    const hook = join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);

    const service = makeProfileService({
      profileDir,
      gitCommit: makeStoreCommit({ repoRoot: root, log: () => {} }),
      audit: makeCommittableAudit({ auditPath: join(profileDir, "_audit.log"), repoRoot: root }),
    });
    const res = await service.route("POST", "/profiles/acme/save", STAFF,
      { profile: { name: "Acme", platforms: ["gnc.com"] } });

    assert.equal(res.status, 200, "the live mutation was hidden behind an error");
    assert.match(res.json.commitError ?? "", /\S/, "the failure must still be named on the response");
    const status = git(root, "status", "--porcelain");
    assert.match(status, /unrelated\.txt/, "the concurrent editor's staged file was touched by a save that did not stage it");
    assert.doesNotMatch(status, /^\?\?/m, "nothing may be left UNTRACKED — that is the state a sync cannot resolve");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1573 the add+commit sequence exists in ONE place — four hand-maintained copies is how they drift", () => {
  // Three services plus this file's own `realCommit` were four copies of the same three commands, and the
  // recipe-service copy had no failure logging at all — an omission nobody saw because each copy reads
  // fine on its own. Discovered by scanning the services, not from a list typed here.
  const roots = ["driver/profile-service.mjs", "driver/recipe-service.mjs", "driver/portal-service.mjs"];
  for (const f of roots) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /execFileSync\("git",\s*\[[^\]]*"add"/,
      `${f} still shells out to \`git add\` directly — the behaviour on failure belongs in one helper`);
    assert.match(src, /makeStoreCommit/, `${f} does not use the shared store committer`);
  }
});
