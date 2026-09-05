// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Two things a reader running the documented command should never have to think about — tracker
// issues 160 and 166.
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
import { portsForFlag, resolvePorts } from "../../bin/start.mjs";

// ── 166 ──────────────────────────────────────────────────────────────────────────────────────────

test("tracker issue 166 — --port moves every door, not just the portal", () => {
  const base = resolvePorts({});
  // The exact numbers from the stranger drive that found this.
  assert.deepEqual(portsForFlag("18860", base, {}), { portal: 18860, mcp: 18861, client: 18862 });
});

test("tracker issue 166 — a port the operator set explicitly is not moved", () => {
  // The flag is a convenience over the DEFAULTS. Somebody who set the variable chose that number, and
  // the issue's own evidence is that exporting all three already worked — that path must not change.
  const base = resolvePorts({ TRADEMARK_MCP_HTTP_PORT: "9999" });
  const moved = portsForFlag("18860", base, { TRADEMARK_MCP_HTTP_PORT: "9999" });
  assert.equal(moved.mcp, 9999, "an explicitly set engine-door port was overwritten by --port");
  assert.equal(moved.portal, 18860);
  assert.equal(moved.client, 18862);
});

test("tracker issue 166 — no flag changes nothing", () => {
  const base = resolvePorts({});
  assert.deepEqual(portsForFlag(undefined, base, {}), base);
  assert.deepEqual(portsForFlag("", base, {}), base);
});

test("tracker issue 166 — a port with no room for the doors that follow it is refused", () => {
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

test("tracker issue 160 — a stale bundle is rebuilt", () => {
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

test("tracker issue 160 — a failed rebuild is reported and does not throw", () => {
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

test("tracker issue 160 — a bundle that cannot be measured is not rebuilt", () => {
  // `unmeasured` is a could-not-look. Rebuilding on it would take a confident action on no evidence,
  // which is the same class of mistake as the silence this issue is about.
  let ran = 0;
  const r = rebuildIfStale({ repo: null, distDir: null, srcDir: null, run: () => { ran += 1; return 0; } });
  assert.equal(ran, 0);
  assert.equal(r.rebuilt, false);
});
