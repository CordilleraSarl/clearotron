// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE SETTINGS SURFACE AND THE RUNS SERVE ONE CUSTOMER STORE.
//
// Seen by the owner on the test portal, signed in as staff with a real brand owner selected: Brand
// profile said "These settings are not available to you", Custom searches "could not be loaded", a save
// "could not be saved". The clearance itself submitted and ran under that owner's framework. Only the
// surface that CONFIGURES them refused, and it refused with a tenancy message — so it read as a
// permissions problem and was two directories.
//
// The surface read `process.env.PROFILE_DIR || join(HERE, "profiles")`. Nothing set PROFILE_DIR: not
// `onboard`, not `.env.example`, not the box's env. So it served the product's BUNDLED DEMO BUNDLE while
// the runs, the roster, the account picker and the artifacts door read CLEAROTRON_CUSTOMERS_DIR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { customerStoreDir, customerStoreLine, customerStoreDivergence } from "../../shared/customer-store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE = join(HERE, "..", "portal-service.mjs");
const BUNDLED = "/bundled/demo";

// ── THE RESOLVER, DRIVEN ────────────────────────────────────────────────────────────────────────────

test("tracker issue 1923 the store is the configured one when CLEAROTRON_CUSTOMERS_DIR is set", () => {
  const r = customerStoreDir({ env: { CLEAROTRON_CUSTOMERS_DIR: "/srv/store" }, bundledDir: BUNDLED });
  assert.deepEqual(r, { dir: "/srv/store", source: "configured" });
});

test("tracker issue 1923 PROFILE_DIR is NOT a fallback — the retired name must not pull a second store", () => {
  // THE POINT OF THE WHOLE ISSUE. Keeping it as a fallback arm would leave a box that sets only the old
  // name serving a different directory to the settings surface than to its runs, which is the split.
  const r = customerStoreDir({ env: { PROFILE_DIR: "/srv/old-store" }, bundledDir: BUNDLED });
  assert.equal(r.dir, BUNDLED, "a retired name must resolve nothing");
  assert.equal(r.source, "bundled");
});

test("tracker issue 1923 an unset store falls back to the bundle DELIBERATELY, and never throws", () => {
  // The negative case, and it matters: a house-defaults install has no customer store and must still get
  // a working settings surface. Turning a wrong-store bug into an outage on every such install would be
  // a worse defect than the one being fixed.
  const r = customerStoreDir({ env: {}, bundledDir: BUNDLED });
  assert.deepEqual(r, { dir: BUNDLED, source: "bundled" });
  assert.throws(() => customerStoreDir({ env: {}, bundledDir: undefined }), /bundledDir is required/,
    "a caller with no bundle must be refused rather than handed undefined, which would read the cwd");
});

test("tracker issue 1923 the startup line says WHICH store, and says when it is only the bundle", () => {
  // Criterion 2. The log named the artifacts roster and the recipes store and never the profile store,
  // which is why finding this took a /proc read.
  const configured = customerStoreLine("settings surface", { dir: "/srv/store", source: "configured" });
  assert.match(configured, /settings surface ON — store=\/srv\/store/);
  assert.match(configured, /CLEAROTRON_CUSTOMERS_DIR/, "and it names the knob that decided");
  const bundled = customerStoreLine("settings surface", { dir: BUNDLED, source: "bundled" });
  assert.match(bundled, /BUNDLED DEMO ROSTER/,
    "a bundle fallback must SAY it is one — it is what a misconfigured deployment also looks like");
  assert.notEqual(configured, bundled, "the two situations must not render the same line");
});

// ── THE DIVERGENCE REPORT, DRIVEN, WITH A CONTROL ───────────────────────────────────────────────────

test("tracker issue 1923 doctor's divergence check reports a split, and can say no", () => {
  assert.deepEqual(
    customerStoreDivergence({ surfaceDir: "/bundled/demo", rosterDir: "/srv/store" }),
    { surface: "/bundled/demo", roster: "/srv/store" },
    "the shape the owner met: surface on the bundle, runs on the real store");
  // THE CONTROL — a predicate that cannot say no is not a predicate.
  assert.equal(customerStoreDivergence({ surfaceDir: "/srv/store", rosterDir: "/srv/store" }), null,
    "agreement is not a finding");
  // A FAILURE TO LOOK IS NOT A FINDING ABOUT THE DEPLOYMENT.
  assert.equal(customerStoreDivergence({ surfaceDir: null, rosterDir: "/srv/store" }), null);
  assert.equal(customerStoreDivergence({ surfaceDir: "/srv/store", rosterDir: null }), null);
  assert.equal(customerStoreDivergence({}), null);
});

// ── THE PORTAL, BOOTED ──────────────────────────────────────────────────────────────────────────────

/** A store that is INSIDE a git repo, so the containment guard is satisfied and saves can commit. */
function storeInRepo(customer) {
  const root = mkdtempSync(join(tmpdir(), "cs1923-repo-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "t@example-firm.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "t"]);
  const store = join(root, "profiles");
  mkdirSync(store);
  // The skills overlay is DERIVED from PROFILE_REPO_ROOT, so a store whose repo has no `skills/` makes
  // the Brand profile page resolve a customer's risk framework against nothing. The portal warns about
  // exactly this at boot; without the directory the profile route answers 500 rather than the customer's
  // settings, which is a different failure from the one this file is about and would mask it.
  mkdirSync(join(root, "skills"), { recursive: true });
  // BUILT FROM A REAL PROFILE, not invented. Every profile key must have a live consumer — the loader
  // rejects an unknown one by name at 500 — so a hand-written fixture is a different failure waiting to
  // be mistaken for this issue's. The customer's KEY is its filename, never a field inside it.
  const template = JSON.parse(readFileSync(join(HERE, "..", "profiles", "generic.json"), "utf8"));
  // A STORE IS NOT A DIRECTORY WITH ONE CUSTOMER IN IT. `generic.json` is REQUIRED — it is the universal
  // fallback and the loader refuses a store without it — so a fixture holding only the customer under
  // test produces a 500 that looks like this issue's refusal and is not.
  writeFileSync(join(store, "generic.json"), JSON.stringify(template));
  writeFileSync(join(store, `${customer}.json`), JSON.stringify({ ...template, name: "Test Owner" }));
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "store"]);
  return { root, store };
}

function bootEnv(extra) {
  const grants = join(mkdtempSync(join(tmpdir(), "cs1923-grants-")), "grants.json");
  writeFileSync(grants, JSON.stringify({ tenants: {} }));
  return {
    ...process.env,
    PORTAL_AUTH_MODE: "local", PORTAL_LOCAL_USER: "dev@example-firm.com",
    PORTAL_LOCAL_CREDENTIAL: join(mkdtempSync(join(tmpdir(), "cs1923-cred-")), "credential.json"),
    CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined,
    PORTAL_SECRET: "cs1923-secret", PORTAL_STAFF_DOMAINS: "example-firm.com",
    CLEAROTRON_ACCESS_FILE: grants,
    CLEAROTRON_REPORTS_DIR: mkdtempSync(join(tmpdir(), "cs1923-pool-")),
    CLEAROTRON_WORK_DIR: mkdtempSync(join(tmpdir(), "cs1923-ws-")),
    PORTAL_SERVICE_HOST: "127.0.0.1",   // PORT is supplied per-boot: see PORT_BASE below
    ...extra,
  };
}

/**
 * The portal's stderr with anything secret taken OUT before it can reach an assertion message.
 *
 * On first boot in local mode the portal MINTS a sign-in passphrase and prints it once. An assertion
 * that embeds raw stderr therefore publishes it — into this runner's output and into CI's logs, where it
 * is durable and world-readable to anyone who can see the run. The value is ephemeral and the credential
 * file is a temp dir this test deletes, so nothing here is a live secret; the habit is the problem, and a
 * test that prints one is the same defect as a service that logs one.
 */
function safe(said) {
  return said.split("\n")
    .map((l) => (/passphrase/i.test(l) ? "[portal-service]   PASSPHRASE: <redacted by the test>" : l))
    .join("\n");
}

/** Boot the portal, keep it alive, and hand back its stderr so far plus the port it chose. */
// A FIXED PORT PER ARM, because the portal cannot tell us an ephemeral one: asked for port 0 it
// binds successfully and then logs `listening on http://127.0.0.1:null/portal`. Nothing can locate a
// service from that line, which is a defect in its own right and is reported on the issue rather than
// worked around silently. These two ports are this file's alone.
let PORT_BASE = 18931;
function boot(extra, { waitMs = 25000 } = {}) {
  const port = String(PORT_BASE++);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVICE], { env: bootEnv({ PORTAL_SERVICE_PORT: port, ...extra }), stdio: ["ignore", "pipe", "pipe"] });
    let said = "";
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(t); resolve({ ...r, child, said, tail: () => said }); } };
    const t = setTimeout(() => finish({ port: null }), waitMs);
    const read = (c) => {
      said += String(c);
      if (/listening on/.test(said)) finish({ port: Number(port) });
      // A surface that refuses to start says so once and the portal keeps serving — resolve on that too,
      // so an arm asserting the store line does not wait out the timeout for a portal that will never listen.
      else if (/config surface unavailable/.test(said) && /listening on/.test(said)) finish({ port: null });
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", () => finish({ port: null }));
    child.on("error", () => finish({ port: null }));
  });
}

test("tracker issue 1923 the booted portal serves the CONFIGURED store, and says so", async () => {
  const { root, store } = storeInRepo("testowner");
  let child;
  try {
    const b = await boot({ CLEAROTRON_CUSTOMERS_DIR: store, PROFILE_REPO_ROOT: root });
    child = b.child;
    // Criterion 2, on a live boot rather than on the formatter.
    assert.match(b.said, /settings surface ON — store=/, "the startup log must name the settings store");
    assert.ok(b.said.includes(store),
      `the line must name the CONFIGURED store, not the bundle [said=${safe(b.said).slice(-400)}]`);
    assert.doesNotMatch(b.said, /config surface unavailable/,
      "a store inside its repo root must not take the settings surface down");
    assert.ok(b.port, `the portal must listen [said=${safe(b.said).slice(-400)}]`);
  } finally {
    try { child?.kill("SIGKILL"); } catch { /* gone */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test("tracker issue 1923 a box that sets ONLY the retired name gets the bundle, not its old store", async () => {
  // The regression arm for the fallback that was deliberately not kept. If PROFILE_DIR ever comes back as
  // a fallback, this boot starts naming `store` again and this arm reds.
  const { root, store } = storeInRepo("testowner");
  let child;
  try {
    const b = await boot({ CLEAROTRON_CUSTOMERS_DIR: undefined, PROFILE_DIR: store, PROFILE_REPO_ROOT: root });
    child = b.child;
    assert.match(b.said, /settings surface ON — store=/, "it still starts, and still says which store");
    assert.ok(!b.said.includes(`store=${store}`),
      `PROFILE_DIR must resolve nothing — the surface named the retired store [said=${safe(b.said).slice(-400)}]`);
    assert.match(b.said, /BUNDLED DEMO ROSTER/,
      "and it must say the bundle is what it fell back to, rather than looking configured");
  } finally {
    try { child?.kill("SIGKILL"); } catch { /* gone */ }
    rmSync(root, { recursive: true, force: true });
  }
});

// ── CRITERION 4 — THE ROUND TRIP, OVER HTTP, AGAINST A REAL STORE ───────────────────────────────────
//
// The two GETs and the save are asserted through the PORT rather than by calling the router in-process,
// because the hop is where this defect lived: the router was always correct about the store it was
// given, and what was wrong was which store the portal handed it.
//
// THE CREDENTIAL IS PRE-CREATED with a known passphrase rather than letting the portal mint one. Two
// reasons, and the second is the one that matters: the test needs to sign in, and a minted passphrase is
// PRINTED to stderr on first boot, so a boot that mints is a boot that publishes a secret into whatever
// captures its output.
test("tracker issue 1923 a brand owner in the configured store can read and save their settings", async () => {
  const { establishCredential } = await import("../portal-local-auth.mjs");
  const CUSTOMER = "testowner";
  const { root, store } = storeInRepo(CUSTOMER);
  const recipes = join(root, "recipes");
  mkdirSync(recipes, { recursive: true });
  const credPath = join(mkdtempSync(join(tmpdir(), "cs1923-kc-")), "credential.json");
  const PASS = "correct horse battery staple 1923";
  establishCredential({ path: credPath, email: "dev@example-firm.com", passphrase: PASS });

  let child;
  try {
    const b = await boot({
      CLEAROTRON_CUSTOMERS_DIR: store, PROFILE_REPO_ROOT: root,
      CLEAROTRON_RECIPES_DIR: recipes, RECIPE_REPO_ROOT: root,
      PORTAL_LOCAL_CREDENTIAL: credPath,
    });
    child = b.child;
    assert.ok(b.port, `the portal must listen [said=${safe(b.said).slice(-400)}]`);
    assert.doesNotMatch(safe(b.said), /config surface unavailable/,
      `the settings surface must be up [said=${safe(b.said).slice(-500)}]`);

    const base = `http://127.0.0.1:${b.port}`;
    const login = await fetch(`${base}/portal/login`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ passphrase: PASS }).toString(),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    assert.ok(cookie, `sign-in returned no session cookie (status ${login.status}) — the rest of this arm would test nothing`);

    const get = (p) => fetch(`${base}${p}`, { headers: { cookie } });
    const profile = await get(`/portal/api/config/profile?account=${CUSTOMER}`);
    assert.equal(profile.status, 200,
      "a brand owner IN the configured store must not be told the settings are not available to them — "
      + `that refusal is what this issue was opened on [body=${(await profile.clone().text()).slice(0, 300)}] `
      + `[said=${safe(b.tail()).slice(-1200)}]`);
    const searches = await get(`/portal/api/config/searches?account=${CUSTOMER}`);
    assert.equal(searches.status, 200, "and their custom searches must load");

    // A CUSTOMER THE STORE DOES NOT HOLD MUST STILL BE REFUSED. Without this the arm above would pass on
    // a surface that had simply stopped checking tenancy, which is a worse defect than the one fixed.
    const stranger = await get("/portal/api/config/profile?account=notinthisstore");
    assert.notEqual(stranger.status, 200, "tenancy must still be enforced — the fix is the STORE, not the gate");

    // ── AND A SAVE LANDS IN THAT STORE AND COMMITS UNDER PROFILE_REPO_ROOT ──────────────────────────
    //
    // Asserted against the FILE and the GIT LOG, never against the 200. A save that answers 200 and
    // writes into the demo bundle is the defect this issue reports; a save that writes the file and
    // fails to commit is the incident, where the profile went live, the audit row
    // recorded commit:null and the orphan blocked every deploy for 19 hours. Both answer 200.
    const current = JSON.parse(await (await get(`/portal/api/config/profile?account=${CUSTOMER}`)).text());
    const edited = { ...(current.profile ?? current), name: "Renamed By The Test" };
    const save = await fetch(`${base}/portal/api/config/profile/save?account=${CUSTOMER}`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ profile: edited }),   // the route wants the object under `profile`, not bare
    });
    assert.equal(save.status, 200, `the save must be accepted [body=${(await save.clone().text()).slice(0, 300)}]`);

    const onDisk = JSON.parse(readFileSync(join(store, `${CUSTOMER}.json`), "utf8"));
    assert.equal(onDisk.name, "Renamed By The Test",
      "the save answered 200 and the file in the CONFIGURED store did not change — which is what a save "
      + "into the demo bundle looks like from the outside");

    const log = execFileSync("git", ["-C", root, "log", "--oneline", "-1", "--name-only"], { encoding: "utf8" });
    assert.match(log, new RegExp(`profiles/${CUSTOMER}\\.json`),
      `the write landed but nothing committed it under PROFILE_REPO_ROOT — the tracker issue 1454 shape, `
      + `where the orphan sits untracked until the next store sync refuses [log=${log}]`);
  } finally {
    try { child?.kill("SIGKILL"); } catch { /* gone */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test("tracker issue 1989 an unbuilt config surface NAMES itself, instead of answering the bare not_found that reads as a refusal", async () => {
  // THE DEFECT, DRIVEN. `PROFILE_REPO_ROOT` that does not contain the store makes `storeInRepo` throw,
  // `makeUpstream` return null, and every /portal/api/config/* route refuse. It refused with 404, which
  // the screens render as "Projects are not available to you" — so a deployment misconfiguration wore
  // the words of an access refusal and the real reason lived only in a boot log. It cost the owner a
  // morning.
  //
  // This arm boots that exact condition rather than asserting on source, because the status code is the
  // whole fix and a source grep cannot tell you what the running service answers.
  const { establishCredential } = await import("../portal-local-auth.mjs");
  const CUSTOMER = "testowner";
  const { store } = storeInRepo(CUSTOMER);
  // The root deliberately does NOT contain the store — that is the misconfiguration being reproduced.
  const elsewhere = mkdtempSync(join(tmpdir(), "cs1989-elsewhere-"));
  execFileSync("git", ["init", "-q", elsewhere]);
  const recipes = join(elsewhere, "recipes");
  mkdirSync(recipes, { recursive: true });
  const credPath = join(mkdtempSync(join(tmpdir(), "cs1989-kc-")), "credential.json");
  const PASS = "correct horse battery staple 1989";
  establishCredential({ path: credPath, email: "dev@example-firm.com", passphrase: PASS });

  let child;
  try {
    const b = await boot({
      CLEAROTRON_CUSTOMERS_DIR: store, PROFILE_REPO_ROOT: elsewhere,
      CLEAROTRON_RECIPES_DIR: recipes, RECIPE_REPO_ROOT: elsewhere,
      PORTAL_LOCAL_CREDENTIAL: credPath,
    });
    child = b.child;
    assert.ok(b.port, `the portal must listen [said=${safe(b.said).slice(-400)}]`);
    // The precondition. If the surface came UP, this arm is testing nothing and must say so rather than
    // pass on a 200 that never exercised the branch.
    assert.match(safe(b.said), /config surface unavailable/,
      `this arm needs the surface DOWN to mean anything [said=${safe(b.said).slice(-600)}]`);

    const base = `http://127.0.0.1:${b.port}`;
    const login = await fetch(`${base}/portal/login`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ passphrase: PASS }).toString(),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    assert.ok(cookie, `sign-in returned no session cookie (status ${login.status}) — the rest of this arm would test nothing`);

    const res = await fetch(`${base}/portal/api/config/profile?account=${CUSTOMER}`, { headers: { cookie } });
    const body = await res.json().catch(() => ({}));
    // The STATUS stays 404 — portal-service.test.mjs pins "never a 500" for this branch and that is
    // still right. The BODY is the fix: `not_found` was all the client had, so the screens rendered a
    // permissions verdict for a deployment fault.
    assert.equal(res.status, 404,
      `the status is deliberately unchanged [got ${res.status} body=${JSON.stringify(body).slice(0, 200)}]`);
    assert.equal(body.error, "config_surface_unavailable",
      "it must NAME the condition, so the client can render the deployment cause rather than a permissions verdict");
    assert.notEqual(body.error, "not_found",
      "the bare not_found is what made a server misconfiguration indistinguishable from a denial");

    // THE 404-NEVER-403 RULE IS UNTOUCHED, and this is the half that proves it. An identity that never
    // got through the door must still be refused BEFORE it can learn anything about the surface's state.
    const nobody = await fetch(`${base}/portal/api/config/profile?account=${CUSTOMER}`);
    const nobodyBody = await nobody.json().catch(() => ({}));
    assert.notEqual(nobodyBody.error, "config_surface_unavailable",
      "an unadmitted caller must not be told the deployment's surface state — the door check runs first");
  } finally {
    if (child) child.kill("SIGKILL");
  }
});
