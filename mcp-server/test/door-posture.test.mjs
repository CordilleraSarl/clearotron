// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the ops MCP face must not hold an auth-proxy posture nobody chose for it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { doorPostureVerdict, isDeclared, loopbackOnly, hostOf } from "../door-posture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOOPBACK = ["127.0.0.1:18821", "localhost:18821"];

test("THE INCIDENT: an UNDECLARED mode on a loopback listener is reported, and names the portal's variables", () => {
  const v = doorPostureVerdict({ declaredMode: undefined, effectiveMode: "cf-access", allowedHosts: LOOPBACK });
  assert.equal(v.state, "warn");
  assert.equal(v.inherited, true);
  assert.match(v.message, /CF_ACCESS_TEAM/, "the second criterion is that the portal's mode must not decide this one — "
    + "so the report has to name whose variables are being borrowed");
  assert.match(v.message, /LOOPBACK-ONLY/);
  assert.ok(v.bootNote, "and it must be sayable at boot, where an operator sees it");
});

test("an EMPTY mode is UNDECLARED — the spelling that is worse than an absent one", () => {
  // `(process.env.X || "")` makes `X=` and an absent X the same to the reader, while bin/start.mjs's
  // add-only env merge treats `X=` as ALREADY PRESENT and will not write the correct value over it. So
  // a blank line suppresses the very write that makes the documented install safe.
  for (const blank of ["", "   ", "\t"]) {
    const v = doorPostureVerdict({ declaredMode: blank, effectiveMode: "cf-access", allowedHosts: LOOPBACK });
    assert.equal(v.inherited, true, `an empty mode (${JSON.stringify(blank)}) must not read as declared`);
  }
  assert.equal(isDeclared(""), false);
  assert.equal(isDeclared(undefined), false);
  assert.equal(isDeclared("token"), true);
});

test("a DECLARED cf-access door on a loopback listener passes — that is our own shipped posture", () => {
  // The test box and production both bind 127.0.0.1 behind a Cloudflare tunnel. An arm that failed this
  // shape would fail the configuration this product ships, which is why the issue's "refuse to start"
  // branch is not the one taken.
  const v = doorPostureVerdict({ declaredMode: "cf-access", effectiveMode: "cf-access", allowedHosts: LOOPBACK });
  assert.equal(v.state, "pass");
  assert.equal(v.inherited, false);
  assert.equal(v.bootNote, null, "a deliberate posture must not print a warning on every boot — a check that "
    + "cries wolf is one everybody learns to ignore");
});

test("a declared token door passes, and an UNDECLARED token door is not reported as inherited", () => {
  assert.equal(doorPostureVerdict({ declaredMode: "token", effectiveMode: "token", allowedHosts: LOOPBACK }).state, "pass");
  // Reaching token mode requires declaring it, so this pairing cannot occur — but if the reader ever
  // changes, "inherited" must stay a statement about the AUTH-PROXY default and not a catch-all.
  const v = doorPostureVerdict({ declaredMode: undefined, effectiveMode: "token", allowedHosts: LOOPBACK });
  assert.equal(v.inherited, false);
});

test("an inherited door that is NOT loopback-only is still reported, without the 401 sentence", () => {
  const v = doorPostureVerdict({ declaredMode: undefined, effectiveMode: "cf-access",
    allowedHosts: ["mcp.example.com:443"] });
  assert.equal(v.state, "warn");
  assert.equal(v.inherited, true);
  assert.doesNotMatch(v.message, /LOOPBACK-ONLY/,
    "the loopback sentence is about a door nothing can reach; asserting it on a reachable one is a wrong claim");
});

test("loopbackOnly needs at least one host — an EMPTY list is not loopback-only", () => {
  // An empty allowedHosts is a state the server refuses to start in (DNS-rebinding protection would be
  // off). Reporting it as "loopback-only" here would describe a door that does not exist, and an empty
  // population answering yes is the pass-by-omission this repo keeps finding.
  assert.equal(loopbackOnly([]), false);
  assert.equal(loopbackOnly(undefined), false);
  assert.equal(loopbackOnly(["127.0.0.1:18821"]), true);
  // IPv6, in the three spellings an allowedHosts list can carry. A naive split on ":" answers "" for
  // every one of them and reports a loopback-only door as reachable — this module's own failure,
  // inverted, and it is what this arm caught while being written.
  assert.equal(hostOf("[::1]:18821"), "::1");
  assert.equal(hostOf("::1"), "::1");
  assert.equal(hostOf("127.0.0.1:18821"), "127.0.0.1");
  assert.equal(hostOf("mcp.example.com"), "mcp.example.com");
  assert.equal(loopbackOnly(["[::1]:18821"]), true);
  assert.equal(loopbackOnly(["::1"]), true);
  assert.equal(loopbackOnly(["[2001:db8::1]:443"]), false, "a routable IPv6 address is not loopback");
  assert.equal(loopbackOnly(["127.0.0.1:18821", "mcp.example.com:443"]), false,
    "one reachable host means the listener is not loopback-only");
});

test("the boot path CONSULTS the verdict inside the auth-proxy branch, and warns rather than refusing", () => {
  // The wiring, because a helper nothing calls is the failure this repository keeps finding — and the
  // branch cannot be driven from here without booting a server on a port.
  const src = readFileSync(join(HERE, "..", "http-server.mjs"), "utf8");
  const branch = src.indexOf("auth ON — issuer=");
  const call = src.indexOf("doorPostureVerdict(");
  assert.ok(branch > 0 && call > branch,
    "the posture must be consulted where the auth-proxy door announces itself, not somewhere a reader must hunt for");
  assert.match(src, /WARNING: \$\{posture\.bootNote\}/,
    "WARNING and not FATAL: a tunnel terminating at a loopback port is a correct deployment and this process "
    + "cannot see one from the inside, so refusing to start would refuse the configuration we ship");
  assert.doesNotMatch(src.slice(branch, call + 400), /process\.exit\(1\)/,
    "nothing on this path may turn a reportable ambiguity into a door that will not open");
});
