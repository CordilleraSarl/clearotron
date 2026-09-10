// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A save commits into the store's repository and stops there. When that repository's branch tracks a
// remote branch, the next person who syncs or pushes the checkout publishes the save, and on a test
// instance that person was doing unrelated work in the same checkout. The service is right not to push
// and right not to refuse; `clearotron doctor` is where an operator learns which kind of repository their
// store is in. So these build each kind with real git and ask, then drive doctor on the two that matter.
//
// Every repository here is bounded by GIT_CEILING_DIRECTORIES: a scratch directory that happens to sit
// inside some other checkout must not answer for the repository the test built.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { whereSavesGo } from "../../shared/store-in-repo.mjs";
import { handRunEnv } from "./drive-env.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ONBOARD = join(REPO, "bin", "onboard.mjs");

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "where-saves-go-"));
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: dir };
  const git = (cwd, ...args) => execFileSync("git",
    ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd, env, stdio: "pipe" });
  const commit = (repo, m = "a save") => git(repo, "commit", "-q", "--allow-empty", "-m", m);
  return { dir, env, git, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A remote with one commit on `main`, and a checkout of it with a store folder inside — the shape that published. */
function sharedCheckout(s) {
  s.git(s.dir, "init", "-q", "--bare", "-b", "main", "remote.git");
  s.git(s.dir, "clone", "-q", "remote.git", "seed");
  s.commit(join(s.dir, "seed"), "seed");
  s.git(join(s.dir, "seed"), "push", "-q", "origin", "main");
  s.git(s.dir, "clone", "-q", "remote.git", "shared");
  const store = join(s.dir, "shared", "profiles");
  mkdirSync(store);
  return { checkout: join(s.dir, "shared"), store };
}

/** A repository of its own with one commit and no remote — the shape the store should have. */
function ownRepository(s, name = "own") {
  s.git(s.dir, "init", "-q", "-b", "main", name);
  s.commit(join(s.dir, name), "seed");
  const store = join(s.dir, name, "profiles");
  mkdirSync(store);
  return { checkout: join(s.dir, name), store };
}

test("a store inside a checkout that tracks a remote branch PUBLISHES, and what is waiting is counted", () => {
  const s = scratch();
  try {
    const { checkout, store } = sharedCheckout(s);
    const before = whereSavesGo(store, { env: s.env });
    assert.equal(before.state, "publishes", JSON.stringify(before));
    assert.equal(before.branch, "main");
    assert.equal(before.upstream, "origin/main");
    assert.equal(before.ahead, 0, "nothing committed here yet, so nothing is waiting");
    s.commit(checkout);
    assert.equal(whereSavesGo(store, { env: s.env }).ahead, 1, "a save committed here and not pushed is counted");
  } finally { s.cleanup(); }
});

test("a store in a repository of its own, with no remote, STAYS HERE", () => {
  const s = scratch();
  try {
    const { store } = ownRepository(s);
    const r = whereSavesGo(store, { env: s.env });
    assert.equal(r.state, "stays-here", JSON.stringify(r));
    assert.equal(r.branch, "main");
    assert.deepEqual(r.remotes, []);
  } finally { s.cleanup(); }
});

test("a remote the branch does not track STAYS HERE, and the remote is still named", () => {
  // A deployment can keep a remote for pushing by hand and still have no tracking branch: a push or
  // pull with no arguments then carries nothing. That is a different posture from the one that
  // published, and reading "has a remote" as "publishes" would call it the same.
  const s = scratch();
  try {
    const { checkout, store } = ownRepository(s);
    s.git(s.dir, "init", "-q", "--bare", "-b", "main", "remote.git");
    s.git(checkout, "remote", "add", "origin", join(s.dir, "remote.git"));
    const r = whereSavesGo(store, { env: s.env });
    assert.equal(r.state, "stays-here", JSON.stringify(r));
    assert.deepEqual(r.remotes, ["origin"]);
  } finally { s.cleanup(); }
});

test("the clone of an EMPTY remote already publishes, before its first commit", () => {
  // Its tracking is configured and `@{u}` has nothing to resolve to until the first commit, so asking
  // `@{u}` answers with a usage error — for a store whose first save a bare push would publish. This is
  // the case that decides the helper reads the branch's configuration rather than `@{u}`.
  const s = scratch();
  try {
    s.git(s.dir, "init", "-q", "--bare", "-b", "main", "empty.git");
    s.git(s.dir, "clone", "-q", "empty.git", "fresh");
    const store = join(s.dir, "fresh", "profiles");
    mkdirSync(store);
    const r = whereSavesGo(store, { env: s.env });
    assert.equal(r.state, "publishes", JSON.stringify(r));
    assert.equal(r.upstream, "origin/main");
    assert.equal(r.ahead, null, "nothing to count against yet — null, never a zero that reads as nothing waiting");
  } finally { s.cleanup(); }
});

test("a detached HEAD, and a branch that tracks a LOCAL branch, both STAY HERE", () => {
  const s = scratch();
  try {
    const { checkout, store } = sharedCheckout(s);
    s.git(checkout, "checkout", "-q", "--detach");
    const detached = whereSavesGo(store, { env: s.env });
    assert.equal(detached.state, "stays-here", JSON.stringify(detached));
    assert.equal(detached.branch, null);

    const own = ownRepository(s, "local-track");
    s.git(own.checkout, "checkout", "-q", "-b", "work", "--track", "main");
    const local = whereSavesGo(own.store, { env: s.env });
    assert.equal(local.state, "stays-here", `a branch tracking "." stays in this repository: ${JSON.stringify(local)}`);
    assert.equal(local.branch, "work");
  } finally { s.cleanup(); }
});

test("a folder in no repository, and a folder that is not there, are told apart — and neither reads as staying here", () => {
  const s = scratch();
  try {
    const bare = join(s.dir, "not-a-repository");
    mkdirSync(bare);
    const none = whereSavesGo(bare, { env: s.env });
    assert.equal(none.state, "not-a-repository", JSON.stringify(none));
    const gone = whereSavesGo(join(s.dir, "not-there"), { env: s.env });
    assert.equal(gone.state, "could-not-look", JSON.stringify(gone));
    assert.match(gone.why, /not-there/, "the reason names what git could not reach");
  } finally { s.cleanup(); }
});

test("doctor WARNS about a store whose checkout publishes its saves, and its exit status does not move for it", () => {
  const s = scratch();
  try {
    const pushed = sharedCheckout(s);
    s.commit(pushed.checkout);
    const own = ownRepository(s);
    const home = join(s.dir, "home");
    const bin = join(s.dir, "bin");
    mkdirSync(home);
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, "node"));
    const doctor = (store) => {
      try {
        const out = execFileSync(process.execPath, [ONBOARD, "--check"], {
          encoding: "utf8", stdio: "pipe", timeout: 120_000,
          // An empty base, so nothing from the shell running the suite reaches doctor but what is named
          // here; `handRunEnv` also clears the two variables that would make it ignore this home.
          env: handRunEnv({ HOME: home, PATH: [bin, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1",
            CLEAROTRON_CUSTOMERS_DIR: store, GIT_CEILING_DIRECTORIES: s.dir }, {}),
        });
        return { code: 0, out };
      } catch (e) { return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
    };
    const said = (out) => out.split("\n").filter((l) => /saves to /.test(l)).join("\n");
    const treated = doctor(pushed.store);
    const control = doctor(own.store);
    assert.match(said(treated.out),
      /tracks origin\/main — whoever next syncs or pushes that checkout publishes them, and 1 commit\(s\) made there have not been pushed yet/,
      `doctor must name the branch it tracks and what is waiting:\n${treated.out.slice(-3000)}`);
    assert.match(said(control.out), /tracks no remote branch — nothing carries them off this machine/,
      `the control must reach the same line and answer the other way:\n${control.out.slice(-3000)}`);
    assert.doesNotMatch(control.out, /publishes them/);
    assert.equal(treated.code, control.code,
      "a warning, never a refusal: a store in a repository someone pushes is a legitimate deployment, so the "
      + "only difference between these two runs must be the line, not the exit status");
  } finally { s.cleanup(); }
});
