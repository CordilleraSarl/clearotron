// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The door announces which customer roster it can actually see, and says so when that is wrong.
//
// THE INCIDENT (2026-07-22). `trademark-ops-mcp` — the loopback door the portal's Start button calls —
// had neither CLEAROTRON_CUSTOMERS_DIR nor the shared EnvironmentFile. It was the only service in the fleet
// with neither. So `driver/profiles.mjs` fell back, silently, to the demo roster bundled at
// driver/profiles, and `start_run` refused the first clearance ever started from the portal with
// "profileKey \"sim-praxis\" names no known customer".
//
// Everything about that sentence points at the customer. The customer was fine. The path was wrong.
// Nothing in any log connected the two, and nothing would have connected them for the NEXT customer
// enrolled either — which is the actual reason this file exists. A config fix relies on whoever writes
// the next unit remembering; a boot check does not.
//
// It WARNS, never fails. The read-only tools on this door are useful without a roster, and turning a
// config slip into a refusal-to-start would trade a bad afternoon for an outage.

import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a child env writes every spelling; — a warning names the name in force
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "http-server.mjs");

/**
 * Boot, WAIT FOR THE LINE THE CALLER IS ABOUT, then kill. Unlike the fail-closed guards, this door is
 * EXPECTED to reach listen.
 *
 * ── IT USED TO KILL ON A FIXED 2.5s TIMER ───────────────────────────────────
 *
 * There was no readiness signal at all: the child was killed after 2500 ms and whatever stderr had
 * arrived by then was asserted against. Under load the boot line has not been written yet, the capture
 * is the empty string, and the arm reds for a reason that has nothing to do with the door. Measured
 * 2026-08-29 on main's own gate with three lanes pushing: one arm red on an empty capture, and the
 * three siblings that share this helper passed at 2515–2687 ms — that is the 2500 ms kill. They passed
 * by MARGIN, not by design.
 *
 * The contract each arm wants is "the door printed this line". So that is what is waited for, and the
 * kill is a BACKSTOP rather than the mechanism: a slow machine now makes this file slower and never
 * makes it wrong. Raising 2500 would have been the same defect at a different threshold, hiding the
 * next occurrence for longer.
 *
 * CI runs on the box we develop on, so the load condition recurs by construction — and the red lands on
 * whoever merged last rather than on whoever owns this file.
 *
 * @param {object} env
 * @param {RegExp} until  the line this caller is about. Resolves as soon as stderr matches it.
 */
function boot(env, until, { backstopMs = 20000, argv = [SERVER] } = {}) {
  return new Promise((resolve) => {
    let stderr = "", settled = false;
    // `argv` is a parameter ONLY so the waiting can be driven by a child whose timing this file
    // controls — see the slow-boot arm at the end. Every real caller takes the default.
    const child = execFile(process.execPath, argv, { env: pinEnvAll({ ...process.env }, env) });   // — every spelling, or a pin of the other one upstream wins
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(backstop);
      try { child.kill(); } catch { /* already gone */ }
      resolve({ code, stderr });
    };
    // ACCUMULATED FROM THE STREAM, not from execFile's callback buffer: the callback only fires once the
    // child has exited, and this child is a server that does not exit on its own. Waiting for it is what
    // the old fixed timer was standing in for.
    child.stderr.on("data", (d) => { stderr += String(d); if (until.test(stderr)) finish(0); });
    child.on("error", () => finish(1));
    child.on("exit", (code) => finish(code ?? 0));
    // THE BACKSTOP. Generous on purpose — it is not the mechanism, it is the thing that stops a wedged
    // child hanging the suite. An arm reaching it has genuinely not seen its line, which is a real
    // failure and reads as one: the assertion below fails on what was actually captured.
    const backstop = setTimeout(() => finish(0), backstopMs);
  });
}

const grantsFile = (accounts) => {
  const dir = mkdtempSync(join(tmpdir(), "roster-grants-"));
  const f = join(dir, "grants.json");
  writeFileSync(f, JSON.stringify({ tenants: { acme: { accounts, users: { "a@acme.test": "*" } } } }));
  return f;
};

/**
 * A profiles store with the named customers in it.
 *
 * The body is COPIED from the shipped driver/profiles/generic.json rather than invented. loadProfiles
 * rejects unknown keys outright ("every profile key must have a live consumer") — an invented shape
 * fails to load, the boot check reports it could not read the roster, and the test would then be
 * asserting against a fixture bug instead of the behaviour.
 */
const profilesDir = (keys) => {
  const dir = mkdtempSync(join(tmpdir(), "roster-profiles-"));
  mkdirSync(dir, { recursive: true });
  for (const k of keys) {
    writeFileSync(join(dir, `${k}.json`), JSON.stringify({
      name: k, matchDomains: [], marketplaceDensity: "dense", platforms: ["amazon.com"],
      defaultClasses: [], defaultJurisdictions: [], selfExclusionOwners: [],
      delivery: { email: "summary", privileged: false },
    }));
  }
  return dir;
};

const BASE = {
  TRADEMARK_MCP_AUTH_DISABLED: "1",
  TRADEMARK_MCP_DEV: "1",
  TRADEMARK_MCP_HTTP_HOST: "127.0.0.1",
  TRADEMARK_MCP_HTTP_PORT: "0",
};

test("boot names the roster and where it came from", async () => {
  const dir = profilesDir(["acme", "generic"]);
  const r = await boot({ ...BASE, CLEAROTRON_ACCESS_FILE: grantsFile(["acme"]), CLEAROTRON_CUSTOMERS_DIR: dir },
    /roster: \d+ customer\(s\) from /);
  assert.match(r.stderr, /roster: \d+ customer\(s\) from /);
  assert.match(r.stderr, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the DIRECTORY is named, because that is the thing that is usually wrong");
  assert.match(r.stderr, /acme/);
});

test("THE GUARD: an unset CLEAROTRON_CUSTOMERS_DIR is called out, not left to be discovered by a refused run", async () => {
  const r = await boot({ ...BASE, CLEAROTRON_ACCESS_FILE: grantsFile(["acme"]), CLEAROTRON_CUSTOMERS_DIR: "" },
    /CLEAROTRON_CUSTOMERS_DIR is unset/);
  assert.match(r.stderr, /WARNING/);
  assert.match(r.stderr, new RegExp(`CLEAROTRON_CUSTOMERS_DIR is unset`));
  // Must state the CONSEQUENCE. A warning naming a variable teaches nothing; one naming the symptom
  // is what someone reading a refusal will actually recognise.
  assert.match(r.stderr, /names no known customer/);
  assert.equal(/FATAL/.test(r.stderr), false, "a warning — the read-only tools still work without a roster");
});

test("THE NEXT CUSTOMER: an account granted access but absent from the roster is named at boot", async () => {
  // This is the check that generalises the incident. Enrol someone in grants, forget their profile (or
  // point this door at a store that does not have it) and the boot line says which account and why —
  // instead of a refusal, weeks later, that reads as though the customer key were a typo.
  const r = await boot({
    ...BASE,
    CLEAROTRON_ACCESS_FILE: grantsFile(["acme", "newcustomer"]),
    CLEAROTRON_CUSTOMERS_DIR: profilesDir(["acme", "generic"]),
  }, /ABSENT from this roster:/);
  assert.match(r.stderr, /WARNING: account\(s\) granted portal access but ABSENT from this roster: newcustomer/);
  assert.match(r.stderr, /names no known customer/, "and links it to the symptom it will produce");
  assert.equal(/acme/.test(r.stderr.split("ABSENT from this roster:")[1] ?? ""), false,
    "the accounts that ARE covered are not listed as problems");
});

test("a fully-covered roster is quiet", async () => {
  const r = await boot({
    ...BASE,
    CLEAROTRON_ACCESS_FILE: grantsFile(["acme"]),
    CLEAROTRON_CUSTOMERS_DIR: profilesDir(["acme", "generic"]),
  }, /roster: \d+ customer\(s\)/);
  assert.equal(/ABSENT from this roster/.test(r.stderr), false);
  assert.equal(/CLEAROTRON_CUSTOMERS_DIR is unset/.test(r.stderr), false);
  assert.match(r.stderr, /roster: 2 customer\(s\)/, "still says what it can see — a silent check is one nobody trusts");
});

test("a tenant granted \"*\" contributes no keys, so it cannot manufacture a false warning", async () => {
  // "*" names no accounts. Treating it as "everything" would compare the roster against itself and
  // warn about nothing, or worse, warn about every account on a wildcard deployment.
  const r = await boot({
    ...BASE,
    CLEAROTRON_ACCESS_FILE: grantsFile("*"),
    CLEAROTRON_CUSTOMERS_DIR: profilesDir(["acme", "generic"]),
  }, /roster: \d+ customer\(s\)/);
  assert.equal(/ABSENT from this roster/.test(r.stderr), false);
});

test("2021 a SLOW boot makes this file slower, never red — driven past the old 2.5s kill", async () => {
  // THE PROOF THE FIX IS THE FIX. The old helper killed the child at a fixed 2500 ms and asserted on
  // whatever had arrived; a boot slower than that produced an EMPTY capture and a red that said nothing
  // about the door. Raising the number would have been the same defect at a different threshold.
  //
  // Driven by a child whose timing this file controls, rather than by loading the box until the real
  // server is slow — that would be a test of the box, and unreproducible besides.
  const slow = join(mkdtempSync(join(tmpdir(), "slow-boot-")), "slow.mjs");
  const AFTER_THE_OLD_KILL = 4000;
  writeFileSync(slow, `setTimeout(() => { process.stderr.write("roster: 2 customer(s) from /somewhere\\n"); }, ${AFTER_THE_OLD_KILL});\n`
    + "setInterval(() => {}, 1000);\n");   // and it does NOT exit, exactly like the real door

  const started = Date.now();
  const r = await boot({}, /roster: \d+ customer\(s\) from /, { argv: [slow] });
  const took = Date.now() - started;

  assert.match(r.stderr, /roster: 2 customer\(s\)/,
    `the line arrived after ${AFTER_THE_OLD_KILL}ms and was not captured — the wait is not waiting`);
  assert.ok(took >= AFTER_THE_OLD_KILL,
    `returned in ${took}ms, before the line could have been written — it did not wait for it`);
  assert.ok(took < 20000, `took ${took}ms — it waited for the backstop rather than for the line`);

  // AND THE OTHER DIRECTION: the old behaviour, reproduced mechanically rather than argued from git
  // history. A kill at 2500 ms against a line written at 4000 ms captures NOTHING — an empty string
  // asserted against, which is exactly the red that landed on whoever merged last. The backstop is the
  // only knob that can produce it now, which is the point: it is a backstop, not the mechanism.
  const cut = await boot({}, /never matches, so only the backstop can end this/, { argv: [slow], backstopMs: 2500 });
  assert.equal(cut.stderr, "",
    "a 2500ms cut captured something — then this arm is not reproducing the defect it claims to");
});
