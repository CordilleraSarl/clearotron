// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a config store a service could never commit into.
//
// WHAT IT DEFENDS. A save is two steps that are not atomic: write the file, then `git add` it. Point the
// second at a repository that does not contain the first and git refuses AFTER the write has landed. The
// save reports written:true — correctly, the file IS live — the audit row records commit:null, and the
// orphan sits untracked forever. Nothing retries it, and the next store sync refuses on the dirty tree.
// Measured on the test box: one save blocked every hourly deploy tick for 19 hours, and the only symptom
// was a line in a deploy log nobody reads.
//
// The recipe service refused on this from the day it was written. The PROFILE service, which is where the
// incident actually happened, did not — the same control, correct in one of the two places that needed it.
//
// The arms below are mostly about the two directions this can be wrong. A false REFUSAL is an outage; a
// false PASS is the status quo the defect already describes. So the predicate must be certain before it
// refuses, and the services must still refuse when it is.

import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { storeInRepo, storeOutsideRepoMessage, makeCommittableAudit, commitWithAuditRow, resolveStoreRepoRoot } from "../../shared/store-in-repo.mjs";

const DRIVER = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");

test("#1454 a store inside its repo is reachable; a sibling is not", () => {
  assert.equal(storeInRepo("/srv/store/profiles", "/srv/store").ok, true);
  assert.equal(storeInRepo("/srv/store", "/srv/store").ok, true, "the store may BE the repo root");
  assert.equal(storeInRepo("/srv/store/a/b/c", "/srv/store").ok, true, "any depth below it");
  assert.equal(storeInRepo("/srv/other/profiles", "/srv/store").ok, false, "a sibling tree is outside");
  assert.equal(storeInRepo("/srv", "/srv/store").ok, false, "the PARENT is outside — git adds downward only");
});

test("#1454 a shared PREFIX is not containment — /srv/storeX is outside /srv/store", () => {
  // The `startsWith(root)` bug, which is what the launcher's lexical test was one character away from.
  // `/srv/store-backup` shares every byte of `/srv/store` and is a different tree; reading it as contained
  // would pass exactly the deployment that is one careless copy away from committing into the wrong repo.
  assert.equal(storeInRepo("/srv/storeX/profiles", "/srv/store").ok, false);
  assert.equal(storeInRepo("/srv/store-backup", "/srv/store").ok, false);
  assert.equal(storeInRepo("/srv/store/profiles", "/srv/store/").ok, true, "a trailing slash on the root is the same root");
});

test("#1454 a SYMLINKED store that really is inside is reachable — the refusal must not fire on a lexical miss", () => {
  // These stores are deployed behind symlinked paths (/opt/cordillera/...). `resolve()` is lexical, so a
  // store genuinely inside the repository resolves to a string that does not look like it — and a false
  // refusal here is an OUTAGE. The predicate asks the filesystem before it refuses.
  const root = mkdtempSync(join(tmpdir(), "sir-root-"));
  const real = join(root, "profiles");
  mkdirSync(real);
  const link = join(mkdtempSync(join(tmpdir(), "sir-link-")), "via-symlink");
  symlinkSync(real, link);
  try {
    assert.equal(storeInRepo(link, root).ok, true,
      "a symlink pointing INTO the repo was refused — that is an outage on a correctly configured box");
    assert.equal(storeInRepo(real, root).ok, true);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(dirname(link), { recursive: true, force: true }); }
});

test("#1454 a symlink pointing OUT of the repo is still refused — the tolerance is not a hole", () => {
  // The other direction, or the arm above only proves the predicate got weaker. A path INSIDE the repo
  // that resolves outside it is the exact shape a lenient check would wave through.
  const root = mkdtempSync(join(tmpdir(), "sir-root2-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "sir-elsewhere-"));
  const link = join(root, "profiles");
  symlinkSync(elsewhere, link);
  try {
    // Lexically inside, so the first test passes it; the filesystem is not consulted when the lexical
    // reading already says contained. Documented rather than asserted as a refusal: git resolves symlinks
    // too, and `git add` through a link into another tree fails the same way. This arm pins that the
    // predicate does NOT claim to catch it, so nobody reads containment as a security boundary.
    assert.equal(storeInRepo(link, root).ok, true,
      "a lexically-contained path is accepted without a filesystem read — this arm records that limit");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(elsewhere, { recursive: true, force: true }); }
});

test("#1454 a path that does not exist YET is judged lexically — absence is not permission", () => {
  // The tempting rule is "cannot determine ⇒ contained", and it is wrong. A store directory that has not
  // been created is still misconfigured if it names another tree: the service creates it on first save and
  // then fails every commit into it, which is the entire defect. So the filesystem can only OVERTURN a
  // lexical miss, never manufacture permission from an unreadable path.
  const gone = join(tmpdir(), "sir-does-not-exist-4f2a", "profiles");
  assert.equal(storeInRepo(gone, join(tmpdir(), "sir-also-gone-4f2a")).ok, false,
    "an absent store naming another tree was accepted — it would orphan its first save");
  // And the containment direction is unaffected by existence: a path lexically inside never consults the
  // filesystem at all, so a first boot on a correct layout cannot be refused for not having run yet.
  assert.equal(storeInRepo(join(tmpdir(), "sir-nope-9c1", "profiles"), join(tmpdir(), "sir-nope-9c1")).ok, true);
});

test("#1454 the message names the KNOB to point, not just the fault", () => {
  const m = storeOutsideRepoMessage({ storeVar: "CLEAROTRON_CUSTOMERS_DIR", storeDir: "/a", repoVar: "PROFILE_REPO_ROOT", repoRoot: "/b" });
  assert.match(m, /CLEAROTRON_CUSTOMERS_DIR \(\/a\)/);
  assert.match(m, /PROFILE_REPO_ROOT \(\/b\)/);
  assert.match(m, /Point PROFILE_REPO_ROOT at the repository that contains the store/,
    "a message that describes the fault without naming the fix makes the reader go looking for it");
});

/** Boot a service with a store outside its repo root and return what it said. */
function bootWithSplitStore(script, env) {
  const root = mkdtempSync(join(tmpdir(), "sir-repo-"));
  const store = mkdtempSync(join(tmpdir(), "sir-store-"));   // deliberately NOT under root
  try {
    const r = spawnSync(process.execPath, [join(DRIVER, script)], {
      encoding: "utf8", timeout: 30000,
      env: pinEnvAll({ ...process.env }, { ...env(store, root), CLEAROTRON_REPORTS_DIR: join(root, "pool") }),
    });
    return { r, store, root };
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); }
}

test("#1454 profile-service REFUSES TO START on a store it could never commit — the gap that caused the incident", () => {
  // Before this, PROFILE_REPO_ROOT unset resolved to the PRODUCT checkout while the store pointed at the
  // config store. Every save wrote, every `git add` failed with "outside repository", and the orphans
  // blocked the store sync until a human removed them.
  const { r } = bootWithSplitStore("profile-service.mjs", (store, root) => ({
    PROFILE_AUTH_DISABLED: "1", PROFILE_DEV: "1",
    CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined,
    CLEAROTRON_CUSTOMERS_DIR: store, PROFILE_REPO_ROOT: root,
    PROFILE_HOST: "127.0.0.1", PROFILE_PORT: "0",
  }));
  assert.equal(r.status, 1, `profile-service started with an uncommittable store (exit ${r.status}). Every save it `
    + "accepts would orphan a file and block the next store sync.");
  assert.match(r.stderr, /FATAL/);
  assert.match(r.stderr, /PROFILE_REPO_ROOT/, "and it must name the knob to point");
});

test("#1454 recipe-service still refuses too — the control that was already right is not traded away", () => {
  const { r } = bootWithSplitStore("recipe-service.mjs", (store, root) => ({
    RECIPE_AUTH_DISABLED: "1", RECIPE_DEV: "1",
    CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined,
    CLEAROTRON_RECIPES_DIR: store, RECIPE_REPO_ROOT: root,
    RECIPE_HOST: "127.0.0.1", RECIPE_PORT: "0",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FATAL/);
  assert.match(r.stderr, /RECIPE_REPO_ROOT/);
});

test("#1454 a service with a CONTAINED store does not refuse — the guard can pass, or it proves nothing", () => {
  // The positive control. A guard that has only ever been seen refusing is indistinguishable from one that
  // refuses everything, and that version would take the config surface down on every correct deployment.
  const root = mkdtempSync(join(tmpdir(), "sir-ok-"));
  const store = join(root, "profiles");
  mkdirSync(store);
  try {
    const r = spawnSync(process.execPath, [join(DRIVER, "profile-service.mjs")], {
      encoding: "utf8", timeout: 15000,
      env: { ...process.env, PROFILE_AUTH_DISABLED: "1", PROFILE_DEV: "1",
        CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined,
        CLEAROTRON_CUSTOMERS_DIR: store, PROFILE_REPO_ROOT: root,
        PROFILE_HOST: "127.0.0.1", PROFILE_PORT: "0" },
    });
    assert.doesNotMatch(String(r.stderr), /is outside PROFILE_REPO_ROOT|Point PROFILE_REPO_ROOT/,
      "a correctly configured store was refused — this guard would 404 every real deployment");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** The portal's own boot env — enough for it to start, borrowed from listen-port-in-use.test.mjs. */
function portalEnv(extra) {
  const grants = join(mkdtempSync(join(tmpdir(), "sir-grants-")), "grants.json");
  writeFileSync(grants, JSON.stringify({ tenants: {} }));
  return {
    PORTAL_AUTH_MODE: "local", PORTAL_LOCAL_USER: "dev@local",
    PORTAL_LOCAL_CREDENTIAL: join(mkdtempSync(join(tmpdir(), "sir-cred-")), "credential.json"),
    CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined,
    PORTAL_SECRET: "sir-test-secret", PORTAL_STAFF_DOMAINS: "example-firm.com",
    CLEAROTRON_ACCESS_FILE: grants,
    CLEAROTRON_REPORTS_DIR: mkdtempSync(join(tmpdir(), "sir-pool-")),
    CLEAROTRON_WORK_DIR: mkdtempSync(join(tmpdir(), "sir-ws-")),
    PORTAL_SERVICE_HOST: "127.0.0.1", PORTAL_SERVICE_PORT: "0",
    ...extra,
  };
}

test("#1454 the PORTAL keeps serving and takes the CONFIG SURFACE down — this file's own ruling, not a fatal", () => {
  // The portal process is what actually orphaned the file on the test box. It must not exit: "a settings
  // surface that cannot start must not take the whole portal down — clearances and reports are the
  // load-bearing product." So the profile bootstrap throws, the existing catch logs the reason once, and
  // the config routes answer 404. A portal that refused to boot would trade a broken editor for an outage.
  const root = mkdtempSync(join(tmpdir(), "sir-prepo-"));
  const store = mkdtempSync(join(tmpdir(), "sir-pstore-"));   // deliberately NOT under root
  try {
    const r = spawnSync(process.execPath, [join(DRIVER, "portal-service.mjs")], {
      encoding: "utf8", timeout: 30000,
      env: { ...process.env, ...portalEnv({ CLEAROTRON_CUSTOMERS_DIR: store, PROFILE_REPO_ROOT: root }) },
    });
    const said = `${r.stdout}${r.stderr}`;
    assert.match(said, /config surface unavailable/,
      "the portal booted with an uncommittable profile store and said nothing — every save would orphan its file");
    assert.match(said, /PROFILE_REPO_ROOT/, "and the line must name the knob to point");
    assert.notEqual(r.status, 1, "the portal must NOT exit on this — that would be an outage, not a degraded editor");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); }
});

test("#1454 an unreachable RECIPE store turns saved searches off WITHOUT taking profiles down", () => {
  // The two stores are configured independently and `recipeRepoRoot` falls back to the profile repo root,
  // so a correct profile setup can carry an incorrect recipe one. Throwing for the recipe half would land
  // in the same catch and 404 the profile surface too — one misconfiguration, two dead surfaces.
  const root = mkdtempSync(join(tmpdir(), "sir-prepo2-"));
  const profiles = join(root, "profiles");
  mkdirSync(profiles);
  const recipes = mkdtempSync(join(tmpdir(), "sir-recipes-"));   // outside `root`
  try {
    const r = spawnSync(process.execPath, [join(DRIVER, "portal-service.mjs")], {
      encoding: "utf8", timeout: 30000,
      env: { ...process.env, ...portalEnv({ CLEAROTRON_CUSTOMERS_DIR: profiles, PROFILE_REPO_ROOT: root, CLEAROTRON_RECIPES_DIR: recipes }) },
    });
    const said = `${r.stdout}${r.stderr}`;
    assert.match(said, /saved searches OFF/, "an uncommittable recipe store must turn its own surface off");
    assert.match(said, /RECIPE_REPO_ROOT/);
    assert.doesNotMatch(said, /config surface unavailable/,
      "the recipe misconfiguration took the PROFILE surface down with it — they are configured independently");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(recipes, { recursive: true, force: true }); }
});

// ── THE SECOND HALF: THE AUDIT ROW RIDES IN THE COMMIT ───────────────────────────────────────────────
//
// The arms above are all about CONFIGURATION, and that is exactly why was reopened: every one of
// them passed while a correctly-configured store still leaked a file on every save. These two cover the
// contract that fixes it. The behaviour they imply is proved by execution against a real git repository
// in the-audit-row-rides-in-the-commit.test.mjs — this is the unit statement of the rule.

test("#1454 the appender hands back a path to STAGE only when a commit could reach it", () => {
  const repo = mkdtempSync(join(tmpdir(), "audit-repo-"));
  const outside = mkdtempSync(join(tmpdir(), "audit-outside-"));
  try {
    const inside = join(repo, "profiles", "_audit.log");
    mkdirSync(join(repo, "profiles"), { recursive: true });
    assert.equal(makeCommittableAudit({ auditPath: inside, repoRoot: repo })({ event: "e" }), inside,
      "an audit path inside the repo was not offered for staging — the row orphans again");

    // OUTSIDE: still written, never staged. `git add` on it would refuse and take a working commit down
    // with it, turning a deployment choice into an outage — the direction this module refuses to fail in.
    const out = join(outside, "_audit.log");
    assert.equal(makeCommittableAudit({ auditPath: out, repoRoot: repo })({ event: "e" }), null);
    assert.ok(existsSync(out), "the row was not written at all — best-effort means best EFFORT");
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("#1454 the row is written BEFORE the commit, and the commit carries it", () => {
  // The order IS the fix, so it is asserted directly rather than inferred from a clean tree: a tree is
  // also clean when the row was never written.
  const seen = [];
  const out = commitWithAuditRow({
    audit: (row) => { seen.push(["audit", row.event]); return "/store/_audit.log"; },
    gitCommit: ({ files }) => { seen.push(["commit", files.join("+")]); return "sha1"; },
    files: ["/store/acme.json"], message: "m", by: "s@example-firm.com", row: { event: "profile-update" },
  });
  assert.deepEqual(seen, [["audit", "profile-update"], ["commit", "/store/acme.json+/store/_audit.log"]],
    "the row must be appended first and then staged alongside the file it describes");
  assert.deepEqual(out, { commit: "sha1", commitError: null });
});

test("#1454 a commit failure is REPORTED, and the row survives it — the 2026-07-18 fix is not traded away", () => {
  const rows = [];
  const out = commitWithAuditRow({
    audit: (row) => { rows.push(row); return "/store/_audit.log"; },
    gitCommit: () => { throw new Error("index.lock exists"); },
    files: ["/store/acme.json"], message: "m", by: "s@example-firm.com", row: { event: "profile-update" },
  });
  // COUNTING ROWS IS THE WRONG ASSERTION for this property. What must hold is
  // that the MUTATION row exists and comes first; a second row now says the commit did not stick,
  // which strengthens the same guarantee rather than trading it away.
  assert.equal(rows[0].event, "profile-update", "a live mutation was left with no record of who made it");
  assert.ok(rows.some((r) => r.event === "store-commit-failed"),
    "and the trail must say the change did not persist — a create that did not stick must not read like one that did");
  assert.equal(out.commit, null);
  assert.match(out.commitError, /index\.lock exists/);
});

test("#1454 a SYMLINKED store still stages its row — the file does not exist yet, the directory does", () => {
  // THE ARM THAT WOULD HAVE CAUGHT A SILENT NO-OP IN PRODUCTION. Every `/opt/cordillera/...` store is
  // reached through a symlink. Asking `storeInRepo` about the audit FILE (which does not exist at wiring
  // time, so it cannot resolve) instead of its DIRECTORY (which does) returns false there: the boot guard
  // passes, no row is ever staged, and nothing reds — the answer is a return value nobody asserts on.
  //
  // Measured before this arm existed, on exactly this fixture: boot guard true, file-level test false.
  const realRoot = mkdtempSync(join(tmpdir(), "audit-sym-real-"));
  const linkDir = mkdtempSync(join(tmpdir(), "audit-sym-link-"));
  try {
    mkdirSync(join(realRoot, "profiles"), { recursive: true });
    const link = join(linkDir, "config");
    symlinkSync(realRoot, link);
    const auditPath = join(link, "profiles", "_audit.log");     // reached through the link; not yet written

    assert.equal(storeInRepo(join(link, "profiles"), realRoot).ok, true,
      "the fixture is wrong — the boot guard must PASS here, or this arm is not about the gap it names");
    assert.equal(makeCommittableAudit({ auditPath, repoRoot: realRoot })({ event: "profile-update" }), auditPath,
      "a symlinked store stopped staging its audit rows, silently — the cure would be a no-op in production");
    assert.ok(existsSync(auditPath), "the row was not written");
  } finally { rmSync(realRoot, { recursive: true, force: true }); rmSync(linkDir, { recursive: true, force: true }); }
});

// ── — THE TWO DOORS RESOLVED THE SAME QUESTION DIFFERENTLY ─────────────────────────────────────
//
// On the test instance, with `RECIPE_REPO_ROOT` unset, the portal came up with saved searches routed at
// the config store while the standalone recipe-service exited 1 — same environment, opposite outcomes,
// because one consulted the profile root as a second chance and the other fell straight to the product
// checkout. Two ends of one contract measuring different things.
//
// The divergent fallback is also the dangerous one: the product checkout is the hourly `--ff-only`
// deploy target, so a resolution that lands there does not fail — it commits saved searches into the
// deploy branch and blocks the next deploy.
test("#1566 the repo root is resolved in one stated order, and says which name answered", () => {
  const env = { RECIPE_REPO_ROOT: "/named/outright", PROFILE_REPO_ROOT: "/config/store" };
  const first = resolveStoreRepoRoot({ names: ["RECIPE_REPO_ROOT", "PROFILE_REPO_ROOT"], fallback: "/product/checkout", env });
  assert.equal(first.root, "/named/outright", "the operator naming the tree wins");
  assert.equal(first.from, "RECIPE_REPO_ROOT", "and the answer says which name supplied it");

  // THE TEST INSTANCE'S CASE, and the whole defect: recipe unset, profile set.
  const second = resolveStoreRepoRoot({ names: ["RECIPE_REPO_ROOT", "PROFILE_REPO_ROOT"],
    fallback: "/product/checkout", env: { PROFILE_REPO_ROOT: "/config/store" } });
  assert.equal(second.root, "/config/store",
    "the config store is the SECOND answer — the product checkout must never win while it is available");
  assert.equal(second.from, "PROFILE_REPO_ROOT");

  // A fresh clone with no environment still serves its in-repo demos.
  const third = resolveStoreRepoRoot({ names: ["RECIPE_REPO_ROOT", "PROFILE_REPO_ROOT"], fallback: "/product/checkout", env: {} });
  assert.equal(third.root, "/product/checkout");
  assert.equal(third.from, "module-relative fallback",
    "and it is nameable as the answer of LAST resort, because it is the one that can commit into the deploy target");
  assert.deepEqual(third.tried, ["RECIPE_REPO_ROOT", "PROFILE_REPO_ROOT"], "the order it looked in, for the refusal message");
});

test("#1566 an empty or whitespace value is not an answer", () => {
  // A variable set to "" is how a half-written env file reads, and treating it as an answer would route
  // saves at the empty string — which resolves to the process cwd, an arbitrary tree.
  for (const bad of ["", "   ", "\t"]) {
    const r = resolveStoreRepoRoot({ names: ["RECIPE_REPO_ROOT", "PROFILE_REPO_ROOT"],
      fallback: "/product/checkout", env: { RECIPE_REPO_ROOT: bad, PROFILE_REPO_ROOT: "/config/store" } });
    assert.equal(r.root, "/config/store", `an empty RECIPE_REPO_ROOT (${JSON.stringify(bad)}) must fall through`);
  }
});

test("#1566 with no fallback and nothing set, it refuses by NAME rather than guessing", () => {
  const r = resolveStoreRepoRoot({ names: ["RECIPE_REPO_ROOT", "PROFILE_REPO_ROOT"], env: {} });
  assert.equal(r.root, null, "no root is not the empty string and not the cwd");
  assert.deepEqual(r.tried, ["RECIPE_REPO_ROOT", "PROFILE_REPO_ROOT"]);
});

test("#1566 both doors read the same order — asserted against the source, not against my memory of it", () => {
  // The two call sites are what actually diverged, so the arm has to be about them. A shared function
  // both files import proves nothing if one of them passes a different list.
  const here = dirname(fileURLToPath(import.meta.url));
  const orders = [];
  for (const f of ["../recipe-service.mjs", "../portal-service.mjs"]) {
    const src = readFileSync(join(here, f), "utf8");
    const m = src.match(/resolveStoreRepoRoot\(\{\s*names:\s*\[([^\]]*)\]/);
    assert.ok(m, `${f} does not call the shared resolver`);
    orders.push(m[1].replace(/["'\s]/g, ""));
  }
  assert.equal(orders[0], orders[1],
    `the doors read different orders again: ${orders.join("  vs  ")}`);
  assert.equal(orders[0], "RECIPE_REPO_ROOT,PROFILE_REPO_ROOT");
});
