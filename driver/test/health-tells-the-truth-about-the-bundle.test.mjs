// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 160, the half `doctor` could not cover — `/portal/health` answered `ui: "built",
// ok: true` over a bundle `doctor` refuses at rc 1.
//
// On the source route `git pull` can never update `portal-ui/dist`: it is not tracked, so a pull that
// moves `portal-ui/src` leaves the built bundle behind and the portal serves the previous screen. The
// operator ran the documented upgrade, it exited 0, nothing warned — and the two surfaces they could
// check disagreed about the same tree without either saying so.
//
// THE ARM MAKES THIS TREE GENUINELY STALE rather than describing a stale one: it moves a source file's
// timestamp forward, reads the verdict, and puts the timestamp back. A synthetic fixture would prove the
// mapping and say nothing about whether the portal reads it.
import test from "node:test";
import assert from "node:assert/strict";
import { statSync, utimesSync, existsSync, readdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleFreshnessCached, makeHttpHandler, makePortalService } from "../portal-service.mjs";
import { healthUi, bundleVerdict } from "../../shared/bundle-freshness.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const REPO = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const SRC = join(REPO, "portal-ui", "src");
const DIST = join(REPO, "portal-ui", "dist");

test("160 health reports a stale bundle as stale, and stops calling itself ok", () => {
  if (!existsSync(join(DIST, "index.html"))) {
    // NOT A SKIP THAT HIDES THE QUESTION. With no bundle built there is nothing that could be stale, and
    // the arm says which state it found rather than passing quietly.
    assert.equal(bundleFreshnessCached(false, { ttl: 0 }), "unbuilt", "no bundle here, and the verdict does not say so");
    assert.deepEqual(healthUi("unbuilt"), { ui: "missing", ok: true });
    return;
  }

  const files = readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(SRC, e.name));
  nonEmpty(files, "the portal's own source files");
  const victim = files[0];
  const was = statSync(victim);
  // THE BASELINE IS THIS TREE'S OWN VERDICT, not "current". A developer who edited `portal-ui/src` and
  // has not rebuilt has a genuinely stale bundle, and an arm demanding a fresh one would be red by the
  // box rather than by the code. What this arm is about is that moving a source file forward CHANGES the
  // answer to stale and that restoring it puts the answer back.
  const baseline = bundleFreshnessCached(true, { ttl: 0 });

  try {
    // Newer than anything in the bundle: this is what a pull does to the sources it moved.
    const future = new Date(Date.now() + 3_600_000);
    utimesSync(victim, future, future);
    const verdict = bundleFreshnessCached(true, { ttl: 0 });
    assert.equal(verdict, "stale", `a source file newer than the bundle read as ${verdict}`);
    assert.deepEqual(healthUi(verdict), { ui: "stale", ok: false },
      "health still calls itself ok over a bundle it has just been told is stale");
  } finally {
    utimesSync(victim, was.atime, was.mtime);
  }

  // And back to what it was — a check that cannot return to its starting answer is one an operator
  // learns to ignore.
  assert.equal(bundleFreshnessCached(true, { ttl: 0 }), baseline,
    "the verdict did not return to what it was before this arm moved a timestamp");
});

test("160 every verdict maps to something an operator can act on", () => {
  // The mapping is total: a verdict with no case would fall through to `built`, which is the answer this
  // whole issue is about.
  for (const [verdict, expected] of [
    ["unbuilt", { ui: "missing", ok: true }],
    ["stale", { ui: "stale", ok: false }],
    ["unmeasured", { ui: "unknown", ok: true }],
    ["current", { ui: "built", ok: true }],
    ["guarded", { ui: "built", ok: true }],
    ["tracked-unguarded", { ui: "built", ok: true }],
    ["no-sources", { ui: "built", ok: true }],
    ["unversioned", { ui: "built", ok: true }],
  ]) {
    assert.deepEqual(healthUi(verdict), expected, `${verdict} maps wrongly`);
  }
  // A COULD-NOT-LOOK IS NOT A FAILURE EITHER. `unmeasured` must not read as ok:false — a health check
  // that flips because a directory could not be stat'd pages somebody for a bundle that is probably fine.
  assert.equal(healthUi("unmeasured").ok, true);
  assert.notEqual(healthUi("unmeasured").ui, "built", "an unmeasurable bundle claimed to be built");
});

test("160 the verdict health reads is the one doctor reads", () => {
  // One predicate, two callers. Driven, not asserted from the imports: both are called on this tree and
  // must answer identically, so a future edit to either surface's copy would part them here.
  const present = existsSync(join(DIST, "index.html"));
  const direct = bundleVerdict({ repo: REPO, distDir: DIST, srcDir: SRC, present });
  assert.equal(bundleFreshnessCached(present, { ttl: 0 }), direct,
    "the portal's cached reader and the shared predicate disagree about this tree");
});


/** The route itself, over a real socket, with a bundle the handler is told is present. */
async function healthBody({ present = true } = {}) {
  const service = makePortalService({
    poolRoot: mkdtempSync(join(tmpdir(), "health-bundle-pool-")),
    workspaceRoot: mkdtempSync(join(tmpdir(), "health-bundle-ws-")),
    secret: "bundle-health-test-secret", staffDomains: [], grants: {},
  });
  const srv = createServer(makeHttpHandler({
    verify: null, limiter: null, service, devIdentity: { email: "dev@local" }, log: () => {},
    static: { present: () => present },
  }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const port = srv.address().port;
    const body = await new Promise((resolve, reject) => {
      const r = httpRequest({ host: "127.0.0.1", port, path: "/portal/health", method: "GET" }, (res) => {
        let d = ""; res.on("data", (c) => { d += c; }); res.on("end", () => resolve(d));
      });
      r.on("error", reject); r.end();
    });
    return JSON.parse(body);
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

test("160 the ROUTE says it, not just the predicate behind it", { timeout: 60_000 }, async () => {
  // THE ARM THAT WAS MISSING. Every other arm here drives the predicate and the mapping, so reverting
  // the route to its presence-only answer left all of them green — measured, by planting exactly that.
  // This one asks the endpoint an operator asks.
  if (!existsSync(join(DIST, "index.html"))) {
    const body = await healthBody({ present: false });
    assert.equal(body.ui, "missing", "an absent bundle is not reported as missing by the route");
    return;
  }
  const files = readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(SRC, e.name));
  nonEmpty(files, "the portal's own source files");
  const victim = files[0];
  const was = statSync(victim);
  try {
    const future = new Date(Date.now() + 3_600_000);
    utimesSync(victim, future, future);
    bundleFreshnessCached(true, { ttl: 0 });   // the route reads a cache; this is the pull that fills it
    const body = await healthBody();
    assert.equal(body.ui, "stale", `the route answered ui:${body.ui} over a bundle older than its sources`);
    assert.equal(body.ok, false, "the route still called itself ok over a stale bundle");
  } finally {
    utimesSync(victim, was.atime, was.mtime);
    bundleFreshnessCached(true, { ttl: 0 });
  }
  const back = await healthBody();
  assert.equal(back.ui, healthUi(bundleFreshnessCached(true, { ttl: 0 })).ui,
    "the route did not return to this tree's own answer after the timestamp was put back");
});
