// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — THE DOOR REFUSED THE ADDRESS THE PRODUCT HANDS OUT ─────────────────
//
// `connect` wrote an allow-list of loopback only, while the same flow serves assistants the public
// address from CLEAROTRON_CLIENT_MCP_URL. Through a tunnel the Host header is the public name, so the door
// answered `Invalid Host header` to the very address the product advertises. The owner hit it on his
// first real connection and worked around it by hand.
//
// WHAT MAKES IT WORSE THAN A MISCONFIGURATION: auth was already VALID when it fired. What an operator
// sees is a working key "failing", with no path forward and nothing naming the cause — the door is up,
// the key is right, and every request is turned away.
//
// BREAK MATRIX:
//   · the public host reaches the allow-list        → break: drop it, arm 1 red
//   · bare AND :443, because both arrive            → break: send one, arm 1 red
//   · an explicit port is honoured as itself        → break: hard-code 443, arm 2 red
//   · loopback is never dropped                     → break: replace it, arm 3 red
//   · a malformed URL does not break the install    → break: throw, arm 4 red
//   · the plan writes what the helper derives       → break: rewrite the literal, arm 5 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedHosts, enablePlan } from "../../shared/client-door.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const list = (...a) => allowedHosts(...a).split(",");

test("2163 the public hostname reaches the allow-list, bare and with :443", () => {
  // THE DEFECT, REPRODUCED: loopback only is what the plan used to write, and it is what a tunnel's
  // Host header never matches.
  const without = list(8848);
  assert.deepEqual(without, ["127.0.0.1:8848", "localhost:8848"],
    "the fixture no longer reproduces the loopback-only list this issue is about");

  const withPublic = list(8848, { CLEAROTRON_CLIENT_MCP_URL: "https://clearotron.example.com/mcp" });
  assert.ok(withPublic.includes("clearotron.example.com"),
    "the bare public name is not allowed — this is the header a TLS client on the default port sends");
  assert.ok(withPublic.includes("clearotron.example.com:443"),
    "the public name with :443 is not allowed — some clients send the port and both arrive here");
});

test("2163 an explicit port is honoured as itself, not rewritten to 443", () => {
  // Somebody publishing on :8443 sends :8443. Hard-coding 443 would fix the common case and leave the
  // uncommon one with exactly the defect this issue is about.
  const l = list(8848, { CLEAROTRON_CLIENT_MCP_URL: "https://clearotron.example.com:8443/mcp" });
  assert.ok(l.includes("clearotron.example.com:8443"), "the published port is not in the allow-list");
  assert.ok(!l.includes("clearotron.example.com:443"), "a port nobody published was allowed instead");
});

test("2163 loopback is never dropped for the public name", () => {
  // A local install has no public name at all, and the portal and health probes reach the door on
  // 127.0.0.1. A plan that swapped loopback for the public host would fix a tunnel by breaking the
  // machine the door runs on.
  for (const url of nonEmpty([
    "https://clearotron.example.com/mcp",
    "https://clearotron.example.com:8443/mcp",
    "http://box.local:8080/mcp",
  ], "the public URLs driven here")) {
    const l = list(8848, { CLEAROTRON_CLIENT_MCP_URL: url });
    assert.ok(l.includes("127.0.0.1:8848"), `loopback vanished for ${url}`);
    assert.ok(l.includes("localhost:8848"), `localhost vanished for ${url}`);
  }
});

test("2163 a malformed or absent URL leaves a working local door", () => {
  // This runs on the install path. An unparseable value in one variable must not take `connect` down —
  // a door that runs and turns one address away is recoverable; a connect that dies on a typo is not.
  for (const bad of ["not a url", "://", "", "   ", undefined]) {
    const l = list(8848, { CLEAROTRON_CLIENT_MCP_URL: bad });
    assert.deepEqual(l, ["127.0.0.1:8848", "localhost:8848"], `a bad URL (${JSON.stringify(bad)}) changed the list`);
  }
  assert.deepEqual(list(8848, {}), ["127.0.0.1:8848", "localhost:8848"]);
});

test("2163 no duplicate entries, whatever the URL says", () => {
  // A public name that IS loopback is a real local-tunnel shape, and a repeated host in the list is a
  // config a reader has to squint at to trust.
  const l = list(8848, { CLEAROTRON_CLIENT_MCP_URL: "http://localhost:8848/mcp" });
  assert.equal(new Set(l).size, l.length, `the allow-list repeats an entry: ${l.join(",")}`);
});

// ---- the JOIN, which is where tonight's other seam lived --------------------------------------

test("2163 the PLAN writes what the derivation produces — driven, not assumed", () => {
  // A helper that is right and a plan that ignores it is the shape this repo met twice in one night:
  // two halves each internally consistent, and the defect living only in the join. So this drives
  // enablePlan itself rather than asserting that it calls the function.
  const base = {
    env: { TRADEMARK_MCP_TOKEN_SECRET: "x", CLEAROTRON_CLIENT_MCP_URL: "https://clearotron.example.com/mcp" },
    address: null, identity: null, issuesKey: false, checkoutDir: "/opt/clearotron",
    unitEnvHasSecret: true, accessFile: "/var/lib/clearotron/grants.json",
  };
  const plan = enablePlan(base);
  assert.ok(plan.possible, `the reference plan refused, so this arm compares nothing: ${JSON.stringify(plan.blockers)}`);

  const written = String(plan.settings.CLIENT_MCP_ALLOWED_HOSTS ?? "");
  assert.ok(written.includes("clearotron.example.com"),
    "the plan still writes a loopback-only allow-list — the derivation exists and the door never sees it");
  assert.ok(written.includes("clearotron.example.com:443"));
  assert.ok(written.includes("127.0.0.1:"), "the plan dropped loopback");

  // And the two agree EXACTLY: the plan is not composing a second list of its own that happens to
  // overlap. The port it resolved is the port the list must name.
  const port = plan.settings.CLIENT_MCP_HTTP_PORT;
  assert.equal(written, allowedHosts(port, base.env),
    "the plan's allow-list and the derivation disagree — one of them is a second authority");

  // WITHOUT the public URL, the plan is byte-for-byte what it always wrote. A local install must not
  // change shape because a tunnel-shaped feature landed.
  const localOnly = enablePlan({ ...base, env: { TRADEMARK_MCP_TOKEN_SECRET: "x" } });
  assert.ok(localOnly.possible, JSON.stringify(localOnly.blockers));
  assert.equal(localOnly.settings.CLIENT_MCP_ALLOWED_HOSTS,
    `127.0.0.1:${localOnly.settings.CLIENT_MCP_HTTP_PORT},localhost:${localOnly.settings.CLIENT_MCP_HTTP_PORT}`,
    "a local install's allow-list changed shape");
});
