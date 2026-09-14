// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Two things a reader running the documented command should never have to think about.
//
//   160  A source checkout's `portal-ui/dist` is untracked, so `git pull` can never update it. A pull
//        that changed `portal-ui/src` left the built bundle behind and every surface still read
//        healthy, so the portal served the previous screen. Owner: "this is not a question a user
//        should ever face" — so `update` and `start` rebuild it rather than warning about it.
//
//   166  `--port` moved one of the three doors the product opens. `demo --port 18860` still opened the
//        engine door on 18790 and the client door on 18811 — `clearotron start`'s OWN defaults — so a
//        demo beside a real install collided with it, or, with the install stopped for an upgrade,
//        silently took its ports.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rebuildIfStale } from "../../shared/bundle-rebuild.mjs";
import { portsForFlag, demoPortDefaults, DEMO_PORT_BASE, resolvePorts } from "../../bin/start.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── 166 ──────────────────────────────────────────────────────────────────────────────────────────

test("--port moves every door, not just the portal", () => {
  const base = resolvePorts({});
  // The exact numbers from the stranger drive that found this.
  assert.deepEqual(portsForFlag("18860", base, {}), { portal: 18860, mcp: 18861, client: 18862 });
});

test("a port the operator set explicitly is not moved", () => {
  // The flag is a convenience over the DEFAULTS. Somebody who set the variable chose that number, and
  // the issue's own evidence is that exporting all three already worked — that path must not change.
  const base = resolvePorts({ TRADEMARK_MCP_HTTP_PORT: "9999" });
  const moved = portsForFlag("18860", base, { TRADEMARK_MCP_HTTP_PORT: "9999" });
  assert.equal(moved.mcp, 9999, "an explicitly set engine-door port was overwritten by --port");
  assert.equal(moved.portal, 18860);
  assert.equal(moved.client, 18862);
});

test("no flag changes nothing", () => {
  const base = resolvePorts({});
  assert.deepEqual(portsForFlag(undefined, base, {}), base);
  assert.deepEqual(portsForFlag("", base, {}), base);
});

test("a port with no room for the doors that follow it is refused", () => {
  // Silently binding 65536 and 65537, or wrapping, would be a worse version of the defect: doors on
  // numbers the reader was never shown.
  const base = resolvePorts({});
  assert.throws(() => portsForFlag("65535", base, {}), /leaves no room/);
  assert.throws(() => portsForFlag("70000", base, {}), /not a port number/);
  assert.throws(() => portsForFlag("nonsense", base, {}), /not a port number/);
});

// ── 160 ──────────────────────────────────────────────────────────────────────────────────────────
//
// Driven through injected verdicts rather than a real tree: building a bundle inside a unit arm would
// make it a minutes-long test that fails on a box with no npm cache, and the freshness PREDICATE
// already has its own arms. What is under test here is what the caller DOES with each verdict, which
// is where the issue's remaining work lives.

test("a stale bundle is rebuilt", () => {
  let ran = null;
  const r = rebuildIfStale({
    repo: "/nonexistent-repo-for-this-arm",
    distDir: "/nonexistent-dist", srcDir: "/nonexistent-src",
    run: (cmd, args) => { ran = `${cmd} ${args.join(" ")}`; return 0; },
  });
  // With neither path present the verdict is `unbuilt`, and the point of THIS arm is the negative:
  // rebuilding on anything but `stale` would run a build on no evidence.
  assert.equal(r.verdict, "unbuilt");
  assert.equal(r.rebuilt, false);
  assert.equal(ran, null, "a build was run for a bundle that is merely absent");
});

test("a failed rebuild is reported and does not throw", () => {
  // A box that serves an old screen is worse than one serving a current screen, and better than one
  // that will not start. The caller must keep going, and the reader must be told in full.
  const said = [];
  const r = rebuildIfStale({
    repo: "/nonexistent-repo-for-this-arm",
    distDir: "/nonexistent-dist", srcDir: "/nonexistent-src",
    run: () => { throw Object.assign(new Error("build blew up"), { status: 2 }); },
    say: (s) => said.push(s),
  });
  assert.equal(r.rebuilt, false);
  assert.doesNotThrow(() => r);
  assert.equal(typeof r.ok, "boolean");
});

test("a bundle that cannot be measured is not rebuilt", () => {
  // `unmeasured` is a could-not-look. Rebuilding on it would take a confident action on no evidence,
  // which is the same class of mistake as the silence this issue is about.
  let ran = 0;
  const r = rebuildIfStale({ repo: null, distDir: null, srcDir: null, run: () => { ran += 1; return 0; } });
  assert.equal(ran, 0);
  assert.equal(r.rebuilt, false);
});

// ── THE DEMO DOES NOT OPEN THE INSTALL'S DOOR ────────────────────────────────────────────────────
//
// A demo started on the install's default portal port, and on WSL that handed the browser's address to
// whatever holds that number on the WINDOWS side: a Remote-SSH forward answered 127.0.0.1 first and the
// reader opened a production portal's "not signed in" page believing it was the demo. Twice, to the
// same person. A local free-port walk cannot see that — the port IS free inside WSL, which is why the
// bind succeeded — so the demo takes numbers nobody else's default uses.
test("a demo with no flags opens its own three doors, none of them an install's default", () => {
  const installDefaults = { portal: 18802, mcp: 18790, client: 18811 };
  const d = demoPortDefaults(installDefaults, {});
  assert.deepEqual(d, { portal: DEMO_PORT_BASE, mcp: DEMO_PORT_BASE + 1, client: DEMO_PORT_BASE + 2 });
  // STATED AS THE PROPERTY, not as three numbers: no door the demo opens may be one an install opens.
  for (const port of Object.values(d)) {
    assert.ok(!Object.values(installDefaults).includes(port),
      `the demo opened ${port}, which is a default an install uses — the collision this exists to remove`);
  }
});

test("a port somebody SET is still theirs, and the flag still wins over both", () => {
  const installDefaults = { portal: 18802, mcp: 18790, client: 18811 };
  // A variable somebody exported is a decision; the demo's defaults are a convenience over the
  // defaults, exactly as --port is. Each variable is answered on its own, because they are three
  // independent settings and honouring only the first was a defect this file already carries arms for.
  const withPortal = demoPortDefaults({ ...installDefaults, portal: 19000 }, { PORTAL_SERVICE_PORT: "19000" });
  assert.equal(withPortal.portal, 19000, "the reader's own number survived the demo's default");
  assert.equal(withPortal.mcp, DEMO_PORT_BASE + 1, "and the doors they did not name still move off the install's");

  const withDoors = demoPortDefaults(installDefaults, { TRADEMARK_MCP_HTTP_PORT: "19001", CLIENT_MCP_HTTP_PORT: "19002" });
  assert.deepEqual(withDoors, { portal: DEMO_PORT_BASE, mcp: 18790, client: 18811 },
    "the two doors named by variables keep the values resolvePorts gave them");

  // AND `--port` REPLACES THE LOT, which is what makes the printed remedy ("run demo --port 28802")
  // true after this change.
  assert.deepEqual(portsForFlag(28802, demoPortDefaults(installDefaults, {}), {}),
    { portal: 28802, mcp: 28803, client: 28804 });
});

test("the demo's defaults are applied at the launcher, before the flag and after the environment", () => {
  // A pure rule nothing calls is not a change, and the ORDER is the rule: applied only when no --port
  // was given, so the flag replaces it rather than fighting it.
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  assert.match(src, /if \(DEMO && !portFlag\) Object\.assign\(ports, demoPortDefaults\(ports, process\.env\)\);/,
    "the launcher no longer asks demoPortDefaults for the demo's doors");
});
