// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN EMPTY CONFIG STORE OVERRIDES NOTHING, AND THE PORTAL READS IT THAT WAY.
//
// Setup writes PROFILE_REPO_ROOT=<config> and deliberately leaves CLEAROTRON_INSTRUCTIONS_DIR unset: an
// install that overrides no instruction file uses the product's own, and setup says so. The portal then
// derived the overlay as <config>/skills whether or not that folder existed. On a store with no `skills`
// folder, every route that resolves a company's risk framework answered 500 (skills_overlay_unreadable),
// and the boot warned that frameworks would resolve to "a SYNTHETIC framework as though it were the
// customer's own" on an install with nothing wrong with it. Measured on the published beta, 2026-09-10:
// the generic company's profile answered 500 with the folder absent and 200 once it was created.
//
// CREATING THE FOLDER IS NOT THE WHOLE FIX, and the store arms below are why. Pinned to an EMPTY folder
// inside the store's git repository, the portal's doctrine-store verdict reads "blocked", because the
// checkout tracks no file under it. Only an unset overlay reads "pass". So a folder that is absent or
// empty is not an overlay at all: it overrides nothing, and the product's own files answer, exactly as
// they do for the engine on the same install.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { establishCredential } from "../portal-local-auth.mjs";
import { installerGrants } from "../../bin/start.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SERVICE = join(HERE, "..", "portal-service.mjs");
const USER = "operator@localhost";
const PASS = "a passphrase this arm sets for itself";

/**
 * The config store as setup and a first `clearotron start` leave it: setup makes the customer folder
 * empty, start makes the store a repository with one empty commit so saved searches can commit.
 * `skills` is the one thing that varies: "absent", "empty", or "committed" (an install that overrides).
 */
function freshStore(skills) {
  const base = mkdtempSync(join(tmpdir(), "empty-store-"));
  const cfg = join(base, "config");
  mkdirSync(join(cfg, "profiles"), { recursive: true });
  mkdirSync(join(cfg, "recipes"), { recursive: true });
  if (skills !== "absent") mkdirSync(join(cfg, "skills"));
  const git = (...a) => execFileSync("git", ["-C", cfg, "-c", "user.email=t@example-firm.com", "-c", "user.name=t", ...a], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "local config store");
  if (skills === "committed") {
    mkdirSync(join(cfg, "skills", "prelim-search"), { recursive: true });
    writeFileSync(join(cfg, "skills", "prelim-search", "house-notes.md"), "An instruction this install keeps for itself.\n");
    git("add", "skills");
    git("commit", "-q", "-m", "an override");
  }
  const grants = join(base, "grants.json");
  writeFileSync(grants, JSON.stringify(installerGrants(null, { user: USER, organisation: "A Firm" }).grants));
  // PRE-CREATED with a known passphrase: the arm has to sign in, and a portal that mints prints the value
  // to the stderr this file captures.
  const credential = join(base, "portal-local-credential.json");
  establishCredential({ path: credential, email: USER, passphrase: PASS });
  return { base, cfg, grants, credential };
}

function envFor(s) {
  const env = {
    ...process.env,
    PORTAL_AUTH_MODE: "local", PORTAL_LOCAL_USER: USER, PORTAL_LOCAL_CREDENTIAL: s.credential,
    CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined,
    PORTAL_SECRET: "empty-store-secret", PORTAL_SERVICE_HOST: "127.0.0.1",
    CLEAROTRON_ACCESS_FILE: s.grants,
    CLEAROTRON_REPORTS_DIR: mkdtempSync(join(s.base, "pool-")),
    CLEAROTRON_WORK_DIR: mkdtempSync(join(s.base, "ws-")),
    // What setup writes, and nothing it does not.
    PROFILE_REPO_ROOT: s.cfg,
    CLEAROTRON_CUSTOMERS_DIR: join(s.cfg, "profiles"),
    CLEAROTRON_RECIPES_DIR: join(s.cfg, "recipes"), RECIPE_REPO_ROOT: s.cfg,
  };
  // Every spelling, so a value inherited from the shell running the suite cannot stand in for the one
  // setup leaves unset.
  pinEnv(env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
  return env;
}

/** Stderr with any passphrase line removed before it can reach an assertion message. */
const safe = (said) => said.split("\n").map((l) => (/passphrase/i.test(l) ? "<a passphrase line, redacted by the test>" : l)).join("\n");

// A fixed port per boot: asked for port 0 the portal cannot say which one it chose. These are this file's.
let PORT = 18971;
function boot(env, { waitMs = 25000 } = {}) {
  const port = String(PORT++);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVICE], { env: { ...env, PORTAL_SERVICE_PORT: port }, stdio: ["ignore", "pipe", "pipe"] });
    let said = "";
    let done = false;
    const finish = (up) => { if (!done) { done = true; clearTimeout(t); resolve({ port: up ? Number(port) : null, child, said: () => said }); } };
    const t = setTimeout(() => finish(false), waitMs);
    const read = (c) => { said += String(c); if (/listening on/.test(said)) finish(true); };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", () => finish(false));
    child.on("error", () => finish(false));
  });
}

async function signedIn(port) {
  const base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/portal/login`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ passphrase: PASS }).toString(),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie, `sign-in returned no session cookie (status ${login.status}), so every arm below would test nothing`);
  return { base, get: (p) => fetch(`${base}${p}`, { headers: { cookie } }) };
}

for (const skills of ["absent", "empty"]) {
  test(`a store with ${skills === "absent" ? "no skills folder" : "an empty skills folder"}: the company profile answers, and nothing is called synthetic`, async () => {
    const s = freshStore(skills);
    let b;
    try {
      b = await boot(envFor(s));
      assert.ok(b.port, `the portal must listen [said=${safe(b.said()).slice(-600)}]`);
      const { base, get } = await signedIn(b.port);

      // THE ROUTE THAT ANSWERED 500: it resolves the company's risk framework, so it reads a skill file.
      const profile = await get("/portal/api/config/profile?account=generic");
      assert.equal(profile.status, 200,
        `the generic company's profile must load on a store that overrides nothing `
        + `[body=${(await profile.clone().text()).slice(0, 300)}] [said=${safe(b.said()).slice(-900)}]`);
      const me = await get("/portal/api/me");
      assert.equal(me.status, 200, "and the page must learn who is signed in");
      assert.ok(JSON.stringify(await me.json()).includes("A Firm"),
        "and which organisation they are in: the roster setup named");

      const said = safe(b.said());
      assert.doesNotMatch(said, /WARNING: skills overlay/,
        `a store that overrides nothing is not a fault, so the boot must not warn about it [said=${said.slice(-900)}]`);
      assert.doesNotMatch(said, /SYNTHETIC/, "and must never tell a fresh install its frameworks may be synthetic");
      assert.match(said, /overrides nothing/, "it says what it did instead, in one line");

      // AND THE DOCTRINE STORE READS AS WHAT IT IS. Pinned to the empty folder, this was "blocked".
      const health = await (await fetch(`${base}/portal/health`)).json();
      assert.deepEqual({ situation: health.store?.situation, outcome: health.store?.outcome },
        { situation: "no-overlay", outcome: "pass" },
        `the store verdict must be "no overlay, pass" [store=${JSON.stringify(health.store)}]`);
    } finally {
      try { b?.child.kill("SIGKILL"); } catch { /* gone */ }
      rmSync(s.base, { recursive: true, force: true });
    }
  });
}

test("a skills folder that holds a committed file is still the overlay: the rule can say yes", async () => {
  // THE CONTROL. A rule that never derives would pass both arms above; this one needs it to derive.
  const s = freshStore("committed");
  let b;
  try {
    b = await boot(envFor(s));
    assert.ok(b.port, `the portal must listen [said=${safe(b.said()).slice(-600)}]`);
    assert.match(safe(b.said()), /skills overlay derived from PROFILE_REPO_ROOT/,
      `a store that overrides something must still be read as the overlay [said=${safe(b.said()).slice(-600)}]`);
    const { base, get } = await signedIn(b.port);
    assert.equal((await get("/portal/api/config/profile?account=generic")).status, 200);
    const health = await (await fetch(`${base}/portal/health`)).json();
    assert.equal(health.store?.situation, "checkout", `the verdict must be about the store's checkout [store=${JSON.stringify(health.store)}]`);
  } finally {
    try { b?.child.kill("SIGKILL"); } catch { /* gone */ }
    rmSync(s.base, { recursive: true, force: true });
  }
});

test("the boot decision, driven over every shape it can meet", async () => {
  const { skillsOverlayAtBoot } = await import("../portal-service.mjs");
  const fails = (code) => () => { const e = new Error(code); e.code = code; throw e; };
  const at = (o) => skillsOverlayAtBoot({
    explicit: null, profileRepoRoot: "/srv/cfg", readdir: () => ["house-notes.md"], exists: () => true, posture: null, ...o,
  });

  let r = at({});
  assert.equal(r.pin, "/srv/cfg/skills", "a folder that holds something is the overlay");
  assert.match(r.line, /skills overlay derived from PROFILE_REPO_ROOT: \/srv\/cfg\/skills/);

  for (const [shape, readdir, says] of [["absent", fails("ENOENT"), /does not exist/], ["empty", () => [], /is empty/]]) {
    r = at({ readdir });
    assert.equal(r.pin, null, `${shape}: a folder that overrides nothing must not be pinned as the overlay`);
    assert.match(r.line, says, `${shape}: the line must say which`);
    assert.match(r.line, /overrides nothing/);
    assert.doesNotMatch(r.line, /WARNING|SYNTHETIC/, `${shape}: and it is not a warning`);
  }

  // EXISTS AND CANNOT BE READ is the one derived case that stays loud: pinned, so every read of it throws
  // by name rather than falling back, and a WARNING that says why. Driven by injection, not chmod, because
  // a suite run as root reads through any mode.
  for (const code of ["EACCES", "ENOTDIR"]) {
    r = at({ readdir: fails(code) });
    assert.equal(r.pin, "/srv/cfg/skills", `${code}: an unreadable folder must stay the overlay, so reading it fails loudly`);
    assert.match(r.line, new RegExp(`^WARNING: skills overlay /srv/cfg/skills exists and cannot be read \\(${code}\\)`));
  }

  r = at({ profileRepoRoot: null });
  assert.equal(r.pin, null);
  assert.match(r.line, /^WARNING: skills overlay unset/, "no config store at all is still the hosted defect, and still warned");

  r = at({ explicit: "/srv/own", exists: () => true });
  assert.deepEqual(r, { pin: null, line: null }, "an overlay the operator set, and can be read, needs no line");
  r = at({ explicit: "/srv/own", exists: () => false });
  assert.match(r.line, /^WARNING: skills overlay unreadable \(\/srv\/own\)/,
    "an overlay the OPERATOR set and cannot be seen keeps today's warning: that is a setting they made");

  r = at({ profileRepoRoot: null, posture: "the demo posture line" });
  assert.equal(r.line, "the demo posture line", "a demo keeps its own sentence where a warning would be");
});

test("setup creates the skills folder its closing note names, and still leaves the variable unset", () => {
  const src = readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8");
  assert.match(src, /mkdirSync\(join\(cfg, "skills"\), \{ recursive: true \}\)/,
    "setup says it created the configuration directories and tells the reader to put overrides in <cfg>/skills");
  assert.doesNotMatch(src, /candidate\["CLEAROTRON_INSTRUCTIONS_DIR"\]\s*=/,
    "the folder is created, not configured: an empty overlay pinned inside the store's repository reads blocked");
});

test("an overlay this process cannot see names both ways it could have been set", async () => {
  // The portal derives the overlay from PROFILE_REPO_ROOT when the operator set nothing, so a sentence
  // saying the operator's variable "is set" sent the first diagnosis to a variable nobody had written.
  const { config } = await import("../driver.config.mjs");
  const prev = process.env.CLEAROTRON_INSTRUCTIONS_DIR;
  pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", join(tmpdir(), "no-such-skills-folder-5e1d"));
  try {
    for (const read of [() => config.resolveSkillPath("skills/prelim-register/digest.md"),
      () => config.resolveSkillPathReport("skills/prelim-register/digest.md")]) {
      assert.throws(read, (e) => /^skills_overlay_unreadable:/.test(e.message)
        && /CLEAROTRON_INSTRUCTIONS_DIR/.test(e.message) && /PROFILE_REPO_ROOT/.test(e.message)
        && !/is set but/.test(e.message));
    }
  } finally {
    pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", prev);
  }
});
