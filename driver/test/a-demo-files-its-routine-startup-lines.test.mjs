// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DEMO FILES ITS ROUTINE STARTUP LINES, AND NOTHING THAT EXPLAINS A FAILURE. A demo's first screen is the progress, the
// sign-in, the connect line and how to stop; a tester counted nineteen developer lines above the passphrase box. Those go to
// the demo's startup file, and one line says where (owner's words, 2026-11-06). What may be filed is listed, not what must be
// shown, because a failure the list did not foresee would otherwise go into the file unseen: each failure arm below has no
// FATAL or WARNING in it, or carries one only on its first line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_ROUTINE_LINES, demoLineOnScreen } from "../../bin/start.mjs";

const START = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "start.mjs");

// Every line a fresh demo's three services printed, measured 2026-11-06, with its folder written as /tmp/trademark-demo.
const HEALTHY = [
  "[trademark-artifacts-http] auth ON — access key required on every request (no auth proxy in front), loopback only, allowedHosts=[127.0.0.1:18861, localhost:18861]",
  "[trademark-artifacts-http] key path: none configured (TRADEMARK_MCP_KEY_SOCKET unset) — a program on this box holding an access key has no door on this process",
  "[trademark-artifacts-http] roster: 2 customer(s) from /tmp/trademark-demo/config/profiles — [demo-brand-owner, generic]",
  "[trademark-artifacts-http] This is `clearotron demo`: it carries Demo Brand Owner, rating under its own framework, with 1 project, and 4 finished clearance reports ready to open. Nothing here is configured against a real customer, and nothing needs to be.",
  "[trademark-artifacts-http] listening on http://127.0.0.1:18861/mcp — READ-ONLY staff surface, firmDomains=[], auth ON (access key)",
  "[portal-service] auth ON — local sign-in, one user (demo@localhost), loopback only",
  "[portal-service] audit log: /tmp/trademark-demo/portal-audit.log — every admin write, refusal and 500 lands here (PORTAL_AUDIT overrides). The journal carries startup and fatals only; a save that a client reported as failed is answerable from that file, not from here.",
  "[portal-service] trigger lane: the engine door takes an access key, and this portal holds one.",
  "[portal-service] trigger lane: ops token sub=portal verbs=start_run,stop_run accounts=demo-brand-owner,generic expires=2026-12-06 (29d)",
  "[portal-service] settings surface ON — store=/tmp/trademark-demo/config/profiles (CLEAROTRON_CUSTOMERS_DIR)",
  "[portal-service] This is `clearotron demo`: it carries Demo Brand Owner, rating under its own framework, with 1 project, and 4 finished clearance reports ready to open. Nothing here is configured against a real customer, and nothing needs to be.",
  "[portal-service] saved searches ON — store=/tmp/trademark-demo/config/recipes repo=/tmp/trademark-demo/config",
  "[portal-service] brief reading OFF — this is the demo, and the demo makes no model call.",
  "[portal-service] local sign-in: no credential at /tmp/trademark-demo/portal-local-credential.json, so one has been created for demo@localhost.",
  "[portal-service]   Its passphrase is in the box printed below; where it cannot be shown, the box says how to get one.",
  "[portal-service] listening on http://127.0.0.1:18860/portal — pool=/tmp/trademark-demo/pool ui=built auth ON (local sign-in)",
  "[trademark-artifacts-client] API-KEY door — no auth proxy in front; a valid account key is MANDATORY on every request (allowedHosts=[127.0.0.1:18862, localhost:18862]).",
  "[trademark-artifacts-client] client ACCOUNT access ON — an account KEY resolves to its granted accounts (run-token sessions unaffected).",
  "[trademark-artifacts-client] listening on http://127.0.0.1:18862/mcp — CLIENT surface (never internal), API-KEY door (key mandatory)",
  "[trademark-artifacts-client] stopping — issued keys SURVIVE this stop and stay valid until they expire; `clearotron disconnect` is what revokes them.",
];

test("every line a fresh demo's services print goes to the startup file only", () => {
  assert.equal(HEALTHY.length, 20, "premise: the measured fresh demo printed twenty lines");
  for (const line of HEALTHY) assert.equal(demoLineOnScreen(line), false, `a fresh demo puts this line on the screen: ${line}`);
});

test("every routine pattern is one a fresh demo printed, so the list files nothing it was not measured to", () => {
  const bodies = HEALTHY.map((l) => /^\[[\w-]+\] (.*)$/.exec(l)[1]);
  for (const re of DEMO_ROUTINE_LINES) assert.ok(bodies.some((b) => re.test(b)), `no measured line matches ${re}`);
});

test("a line that explains a failure stays on the screen, tagged or not", () => {
  const failures = [
    // A refusal's first line carries the alarm; the rest of it, the cause and the remedy, carry no tag.
    "[trademark-artifacts-client] FATAL: the client door cannot start — 127.0.0.1:18862 is already in use.",
    "  The usual cause is a second copy of the client door that is still running; the product's ports are fixed defaults, so two checkouts on one box collide.",
    // Failures a service reports in words of its own, and keeps running.
    "[trademark-artifacts-http] roster: could not be read (ENOENT) — start_run's customer validation is unverified at boot",
    "[portal-service] local sign-in unavailable: the credential file could not be read",
    "[portal-service] 500 Cannot read properties of undefined (reading 'accounts')",
    "[portal-service] trigger lane: NOT WIRED — TRADEMARK_MCP_OPS_TOKEN unset. The portal starts and serves, its health ",
    "[portal-service] trigger lane: could not check whether the engine door accepts this portal (fetch failed) — not a verdict either way.",
    "[portal] could not re-mint the engine credential (EACCES) — ",
    // A routine line's own words, with an alarm in them.
    "[portal-service] listening on http://127.0.0.1:18860/portal — pool=/tmp/trademark-demo/pool ui=MISSING auth ON (local sign-in)",
    "[portal-service] WARNING: no UI bundle at /tmp/trademark-demo/dist — /portal will answer 503 until it is restored",
    // A crash, as the runtime prints it.
    "Error: listen EADDRINUSE: address already in use 127.0.0.1:18862",
    "    at Server.setupListenHandle [as _listen2] (node:net:1908:16)",
    "⚠ the archive could not be seeded",
  ];
  for (const line of failures) assert.equal(demoLineOnScreen(line), true, `a failure line is filed out of sight: ${line}`);
});

test("a blank line is filed, not printed", () => {
  for (const line of ["", "   ", undefined, null]) assert.equal(demoLineOnScreen(line), false);
});

test("the supervisor says where the file is before any service starts, and a real install's output is untouched", () => {
  const src = readFileSync(START, "utf8");
  assert.match(src, /const DEMO_STARTUP_LOG = DEMO \? join\(paths\.base, "startup\.log"\) : null;/,
    "the startup file is not in the demo's own folder, which the demo removes when it stops");
  const said = src.indexOf("say(`  Startup details are in \\`${DEMO_STARTUP_LOG}\\`.`);");
  assert.ok(said > 0, "the owner's line naming the startup file is gone");
  assert.ok(said < src.indexOf('const mcp = start("the engine door"'), "the line naming the file comes after a service has started");
  assert.match(src.slice(src.lastIndexOf("if (DEMO) {", said), said), /writeFileSync\(DEMO_STARTUP_LOG, ""\)/,
    "a kept folder's file carries an earlier demo's lines under the line that points at this one");
  // THE MAIN BLOCK READS THE LIST BEFORE ANY LINE BELOW IT RUNS, so a list declared after it is not yet there when the first
  // service line arrives: every demo then stopped on a ReferenceError.
  for (const name of ["export const DEMO_ROUTINE_LINES", "export const DEMO_ALARM"])
    assert.ok(src.indexOf(name) > 0 && src.indexOf(name) < src.indexOf("if (isMain) {"), `${name} is declared after the main block`);
  // CONTROL: a real install inherits its services' output and forwards their errors unchanged.
  assert.match(src, /stdio: \["ignore", DEMO \? "pipe" : "inherit", "pipe"\]/);
  assert.match(src, /if \(!DEMO\) process\.stderr\.write\(chunk\);/);
  // A service that does not answer has its last lines shown before the sentence that points at them.
  for (const who of ["mcp", "portal"])
    assert.match(src, new RegExp(`if \\(${who}\\.alive\\) \\{ showFiledTail\\(${who}\\); err\\(.*its output above says why`),
      `${who}: a demo points at output it filed instead of showing`);
});
