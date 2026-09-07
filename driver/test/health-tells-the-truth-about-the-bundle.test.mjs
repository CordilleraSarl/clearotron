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
import { utimesSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleFreshnessCached, makeHttpHandler, makePortalService } from "../portal-service.mjs";
import { healthUi, bundleVerdict } from "../../shared/bundle-freshness.mjs";

const REPO = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const SRC = join(REPO, "portal-ui", "src");
const DIST = join(REPO, "portal-ui", "dist");

// ── A TREE OF ITS OWN, BECAUSE THESE ARMS USED TO MOVE THIS ONE'S CLOCK ──────────────────────────────
//
// Two arms below prove that a source file newer than the bundle reads as `stale` and that putting it
// back restores the answer. They did that by picking a real file out of `portal-ui/src`, setting a future
// mtime on it, and restoring it in a `finally`.
//
// THE RESTORE CANNOT PUT IT BACK EXACTLY. `utimesSync` does not round-trip a stat's sub-millisecond
// mtime — the sibling guard says so in as many words — so the restore landed ~0.24ms away and every full
// suite run reported `~ portal-ui/src/base.css — changed by the run`. Measured either side of a run: same
// inode, same size, same sha256, mtime `…934.7593` → `…934.999`. Nothing wrote the file; only its clock
// moved, and a stamp of `mtimeMs:size` cannot tell that from a write. Which is right — it must not.
//
// So the arms get their own checkout. It is a real one — `git init`, a real `portal-ui/src`, a real
// `portal-ui/dist` left UNTRACKED so the verdict reaches the mtime comparison rather than stopping at
// `tracked`. That keeps what these arms are for: they still read real mtimes off a real tree through the
// real resolver, which is what the baseline comment below calls deliberate. They simply stop reading
// THIS one.
function bundleFixture() {
  const root = mkdtempSync(join(tmpdir(), "bundle-fixture-"));
  mkdirSync(join(root, "portal-ui", "src"), { recursive: true });
  mkdirSync(join(root, "portal-ui", "dist"), { recursive: true });
  writeFileSync(join(root, "portal-ui", "src", "base.css"), ":root{}\n");
  writeFileSync(join(root, "portal-ui", "dist", "index.html"), "<!doctype html>\n");
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  // `portal-ui/src` is tracked and `portal-ui/dist` is NOT: an untracked dist is what sends the verdict
  // past `tracked` and into the mtime comparison these arms are about.
  git("add", "portal-ui/src");
  git("commit", "-qm", "fixture");
  // The bundle is newer than its sources to begin with, which is the state a fresh build leaves.
  const later = new Date(Date.now() + 1000);
  utimesSync(join(root, "portal-ui", "dist", "index.html"), later, later);
  return {
    root,
    src: join(root, "portal-ui", "src", "base.css"),
    drop: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("160 health reports a stale bundle as stale, and stops calling itself ok", () => {
  if (!existsSync(join(DIST, "index.html"))) {
    // NOT A SKIP THAT HIDES THE QUESTION. With no bundle built there is nothing that could be stale, and
    // the arm says which state it found rather than passing quietly.
    assert.equal(bundleFreshnessCached(false, { ttl: 0 }), "unbuilt", "no bundle here, and the verdict does not say so");
    assert.deepEqual(healthUi("unbuilt"), { ui: "missing", ok: true });
    return;
  }

  const fx = bundleFixture();
  // THE BASELINE IS THE FIXTURE'S OWN VERDICT, not "current" — the same reasoning as before, on a tree
  // whose clock these arms are allowed to move. A bundle newer than its sources reads current; what this
  // arm is about is that moving a source forward CHANGES the answer to stale and putting it back
  // restores it.
  const baseline = bundleFreshnessCached(true, { ttl: 0, repo: fx.root });

  try {
    // Newer than anything in the bundle: this is what a pull does to the sources it moved.
    const future = new Date(Date.now() + 3_600_000);
    utimesSync(fx.src, future, future);
    const verdict = bundleFreshnessCached(true, { ttl: 0, repo: fx.root });
    assert.equal(verdict, "stale", `a source file newer than the bundle read as ${verdict}`);
    assert.deepEqual(healthUi(verdict), { ui: "stale", ok: false },
      "health still calls itself ok over a bundle it has just been told is stale");
    // And back to what it was — a check that cannot return to its starting answer is one an operator
    // learns to ignore. Asserted INSIDE the try, against the fixture, because the fixture is what the
    // baseline was taken from and it does not outlive the `finally`.
    const past = new Date(Date.now() - 3_600_000);
    utimesSync(fx.src, past, past);
    assert.equal(bundleFreshnessCached(true, { ttl: 0, repo: fx.root }), baseline,
      "the verdict did not return to what it was before this arm moved a timestamp");
  } finally {
    fx.drop();
  }
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
  // THE ROUTE READS A CACHE, and that is what lets this arm keep its meaning without moving this tree's
  // clock. `bundleCache` is ONE module-level slot keyed on `present` and time — the repository that
  // produced the verdict is NOT in the key — so a pull against the fixture with a live TTL is the verdict
  // the route then answers from. The route, the handler and the mapping are all still the real ones; only
  // the tree whose mtimes were read is ours.
  //
  // THAT COUPLING IS ASSERTED, NOT ASSUMED, and this is the second version of this arm. The first primed
  // the cache and went straight to the route, which passed on a machine whose real bundle happened to
  // read stale and failed on one with a freshly built stub — the route was answering the real tree's own
  // verdict through a cache miss, and the arm could not tell that from success. So the precondition is
  // now a line of its own: if anything evicts or recomputes between the pull and the route, THAT fails
  // and says so, instead of this arm passing or failing for a reason that has nothing to do with the
  // route. Whoever adds `repo` to the cache key will red the precondition, and its message says why.
  const fx = bundleFixture();
  try {
    const future = new Date(Date.now() + 3_600_000);
    utimesSync(fx.src, future, future);
    bundleFreshnessCached(true, { ttl: 0, repo: fx.root });   // ttl 0 FORCES the recompute that fills it
    assert.equal(bundleFreshnessCached(true), "stale",
      "the cache did not carry the fixture's verdict to a default-argument caller — the route reads it "
      + "the same way, so this arm would have been asserting the real tree's answer rather than the "
      + "fixture's. If `repo` has been added to the cache key, this arm needs a different mechanism.");
    const body = await healthBody();
    assert.equal(body.ui, "stale", `the route answered ui:${body.ui} over a bundle older than its sources`);
    assert.equal(body.ok, false, "the route still called itself ok over a stale bundle");

    const past = new Date(Date.now() - 3_600_000);
    utimesSync(fx.src, past, past);
    const restored = bundleFreshnessCached(true, { ttl: 0, repo: fx.root });
    bundleFreshnessCached(true, { ttl: 0, repo: fx.root });
    assert.equal(bundleFreshnessCached(true), restored, "the cache did not carry the restored verdict either");
    const back = await healthBody();
    assert.equal(back.ui, healthUi(restored).ui,
      "the route did not return to the fixture's own answer after the timestamp was put back");
  } finally {
    fx.drop();
    bundleFreshnessCached(true, { ttl: 0 });   // leave the cache holding THIS tree's verdict, not ours
  }
});
