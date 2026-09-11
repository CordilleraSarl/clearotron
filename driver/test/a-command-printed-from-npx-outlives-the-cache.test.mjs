// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A COMMAND PRINTED FROM NPX'S CACHE OUTLIVES THE CACHE.
//
// Run from npx, the package lives in npm's cache, and every command a verb printed through the shared
// prefix read `cd <npm's cache> && npx clearotron …`. npm deletes that directory when it cleans its cache,
// so the command stopped working before its reader typed it (a packaged-install drive of `doctor`,
// 2026-09-11). From the cache the prefix now names the published version, `npx -p clearotron@<version>`,
// which runs from any directory. These arms drive the layouts through the shared prefix: the npx cache,
// and one control for each other layout, which must print exactly what it printed before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { invocationForm, invocationPrefix, invoke, reachableCommand, standFrom } from "../../shared/invocation.mjs";
import { INSTALL_DIR } from "../../shared/verb-shim.mjs";
import { passphraseResetCommand } from "../../driver/portal-local-auth.mjs";

const NPX = "/opt/cache/_npx/a1b2/node_modules/clearotron";
const GLOBAL = "/opt/tools/lib/node_modules/clearotron";
const NO_SHIM = Object.freeze({ HOME: "/home/nobody-in-particular", PATH: "/usr/bin:/bin" });
const NPX_ENV = Object.freeze({ ...NO_SHIM, npm_command: "exec", npm_lifecycle_event: "npx" });
const ARRIVAL = "/opt/cache/_npx/a1b2/node_modules/.bin/clearotron";
/** A disk holding nothing but the npx install's own manifest, at `version`. */
const npxDisk = (version) => Object.freeze({
  exists: () => false,
  read: (p) => {
    if (p === join(NPX, "package.json") && version) return JSON.stringify({ version });
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  },
});

test("from npx's cache the prefix names the published version, never the cache", () => {
  const form = invocationForm(NPX_ENV, npxDisk("0.3.0-beta.9"), NPX);
  assert.equal(form.form, "npx-pinned");
  assert.equal(form.prefix, "npx -p clearotron@0.3.0-beta.9 ");
  // Every route into the shared prefix lands on it: npm's environment, the path alone, and the verb a
  // dispatcher spawned with the reader's argv handed down.
  for (const [label, argv1, env] of [
    ["npm's environment", join(NPX, "bin", "onboard.mjs"), NPX_ENV],
    ["the path alone", ARRIVAL, NO_SHIM],
    ["a spawned verb", join(NPX, "bin", "onboard.mjs"), { ...NPX_ENV, CLEAROTRON_INVOKED_AS: ARRIVAL }],
  ]) {
    const prefix = invocationPrefix(argv1, env, npxDisk("0.3.0-beta.9"), NPX);
    assert.equal(prefix, "npx -p clearotron@0.3.0-beta.9 ", label);
    assert.doesNotMatch(invoke("doctor", argv1, env, npxDisk("0.3.0-beta.9"), NPX), /_npx|\bcd /, `${label}: a command names the cache`);
  }
  // The terminal helper and the prefix now agree, so a remedy reads the same wherever it is composed.
  assert.equal(invoke("start", ARRIVAL, NO_SHIM, npxDisk("0.3.0-beta.9"), NPX), "npx -p clearotron@0.3.0-beta.9 clearotron start");
  assert.match(reachableCommand("start", { argv1: ARRIVAL, env: NO_SHIM, io: npxDisk("0.3.0-beta.9"), installDir: NPX, read: npxDisk("0.3.0-beta.9").read }), /^npx (-p )?clearotron@0\.3\.0-beta\.9 /);
});

test("the one caller that splices into the prefix still binds its variable to the verb", () => {
  // passphraseResetCommand puts PORTAL_LOCAL_CREDENTIAL after the prefix's last `&& `. The pinned prefix
  // has none, so the assignment leads the line, where npx hands it to the verb it runs.
  const line = passphraseResetCommand({ prefix: invocationPrefix(ARRIVAL, NO_SHIM, npxDisk("0.3.0-beta.9"), NPX), env: { PORTAL_LOCAL_CREDENTIAL: "/srv/ops/creds.json" }, home: "/home/nobody-in-particular" });
  assert.match(line, /^PORTAL_LOCAL_CREDENTIAL=\S+ npx -p clearotron@0\.3\.0-beta\.9 clearotron passphrase --reset$/);
});

test("every other layout prints what it printed before", () => {
  // AN UNREADABLE VERSION falls through to the cache form rather than naming a version it guessed.
  assert.equal(invocationForm(NPX_ENV, npxDisk(null), NPX).form, "in-place");
  assert.equal(invocationPrefix(ARRIVAL, NO_SHIM, npxDisk(null), NPX), `cd ${standFrom(NPX)} && npx `);
  // A GLOBAL INSTALL off PATH keeps its executable's full path; one on PATH keeps the bare name.
  const globalDisk = { exists: (p) => p === "/opt/tools/bin/clearotron", read: npxDisk(null).read };
  assert.equal(invocationForm(NO_SHIM, globalDisk, GLOBAL).prefix, "/opt/tools/bin/");
  assert.equal(invocationForm({ ...NO_SHIM, PATH: "/opt/tools/bin:/usr/bin" }, globalDisk, GLOBAL).prefix, "");
  // A READABLE MANIFEST DOES NOT MAKE A CACHE: only an install in npx's cache is pinned.
  const SRC = "/opt/src/clearotron";
  const srcDisk = { exists: () => false, read: (p) => {
    if (p === join(SRC, "package.json")) return JSON.stringify({ version: "0.3.0-beta.9" });
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  } };
  assert.equal(invocationForm(NO_SHIM, srcDisk, SRC).form, "in-place", "an install outside npx's cache was pinned");
  // A CHECKOUT is not in npx's cache, so an npx arrival there keeps the checkout's own form.
  assert.equal(invocationPrefix(ARRIVAL, NPX_ENV, npxDisk(null), INSTALL_DIR), `cd ${standFrom(INSTALL_DIR)} && npx `);
  // And a reader who typed the bare name is answered with it, whatever the disk says.
  assert.equal(invocationPrefix("/usr/local/bin/clearotron", NO_SHIM, npxDisk("0.3.0-beta.9"), NPX), "");
});
